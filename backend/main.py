import os
from datetime import datetime
from typing import Optional, List, Dict
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from db import init_db, upsert_lead, list_leads, update_status

# 👇 carica backend/.env
load_dotenv()

app = FastAPI(title="Local Business Finder API")

# ✅ CORS: permette tutte le preview / deploy netlify + localhost
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https://.*\.netlify\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")


@app.on_event("startup")
def _startup():
    init_db()


class PlaceOut(BaseModel):
    place_id: str
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    rating: Optional[float] = None
    website: Optional[str] = None


class LeadIn(BaseModel):
    place_id: str
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    rating: Optional[float] = None
    website: Optional[str] = None
    city: str
    category: str


class LeadOut(BaseModel):
    id: int
    place_id: str
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    rating: Optional[float] = None
    website: Optional[str] = None
    city: Optional[str] = None
    category: Optional[str] = None
    status: str
    created_at: str


class StatusPatch(BaseModel):
    status: str  # es: "nuovo", "contattato", "non_interessato"


@app.get("/")
def root():
    return {"status": "ok"}


# ✅ Fix Render: Render fa HEAD / per health-check → evitiamo 405
@app.head("/")
def head_root():
    return Response(status_code=200)


@app.get("/health")
def health():
    return {"ok": True, "has_google_key": bool(GOOGLE_API_KEY)}


# ==========================
# MESSAGE TEMPLATE (EDITABILE)
# ==========================

def get_greeting_with_title() -> str:
    hour = datetime.now().hour

    if 5 <= hour < 12:
        greeting = "Buongiorno"
    elif 12 <= hour < 18:
        greeting = "Buon pomeriggio"
    else:
        greeting = "Buonasera"

    # ✅ stile fisso professionale
    title = "Spett.le Ditta"
    # alternativa:
    # title = "Gentile Titolare"

    return f"{greeting} {title}"


def build_message_text(name: str, city: str, category: str) -> str:
    nome = (name or "").strip() or "la vostra attività"
    zona = (city or "").strip() or "la tua zona"
    cat = (category or "").strip() or "attività"
    saluto = get_greeting_with_title()

    return (
        f"{saluto},\n"
        f"ho visto {nome} su Google Maps e vi contatto perché una buona visibilità online "
        f"contribuisce in modo diretto ad attirare nuovi clienti.\n\n"
        f"Mi occupo di soluzioni digitali per il mercato locale, dai siti web e landing page "
        f"fino ad applicazioni mobile e altre soluzioni tecnologiche, pensate per migliorare "
        f"la visibilità e facilitare il contatto con i clienti, senza complicazioni.\n\n"
        f"Sono disponibile per un colloquio senza impegno.\n"
        f"Zona: {zona} • Categoria: {cat}\n"
        f"Un cordiale saluto 🙂"
    )


# ✅ QUESTO È L’ENDPOINT CHE IL FRONTEND STA CHIAMANDO (/message)
@app.get("/message")
def message(
    name: str = Query("", description="Nome attività"),
    city: str = Query("", description="Città/Provincia"),
    category: str = Query("", description="Categoria"),
) -> Dict[str, str]:
    """
    Ritorna il testo WhatsApp generato dal backend.
    Così puoi modificarlo qui e non rifare build del frontend.
    """
    return {"text": build_message_text(name=name, city=city, category=category)}


# ✅ Alias (se in passato usavi /message-template)
@app.get("/message-template")
def message_template(
    name: str = Query("", description="Nome attività"),
    city: str = Query("", description="Città/Provincia"),
    category: str = Query("", description="Categoria"),
) -> Dict[str, str]:
    return {"text": build_message_text(name=name, city=city, category=category)}


# ==========================
# GOOGLE PLACES
# ==========================

def places_text_search(query: str, region: str = "it") -> dict:
    url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
    params = {"query": query, "region": region, "key": GOOGLE_API_KEY}
    r = requests.get(url, params=params, timeout=20)
    r.raise_for_status()
    return r.json()


def place_details(place_id: str) -> dict:
    url = "https://maps.googleapis.com/maps/api/place/details/json"
    params = {
        "place_id": place_id,
        "fields": "place_id,name,formatted_address,formatted_phone_number,rating,website",
        "key": GOOGLE_API_KEY,
    }
    r = requests.get(url, params=params, timeout=20)
    r.raise_for_status()
    return r.json()


def demo(city: str, category: str) -> List[PlaceOut]:
    return [
        PlaceOut(
            place_id="demo1",
            name=f"{category.title()} Da Mario",
            address=f"Via Roma 10, {city}",
            phone="+39 0833 000000",
            rating=4.4,
            website=None,
        ),
        PlaceOut(
            place_id="demo2",
            name=f"{category.title()} Bella Napoli",
            address=f"Corso Italia 22, {city}",
            phone="+39 0833 111111",
            rating=4.1,
            website="https://example.com",
        ),
        PlaceOut(
            place_id="demo3",
            name=f"{category.title()} Il Forno",
            address=f"Via XX Settembre 5, {city}",
            phone=None,
            rating=4.6,
            website=None,
        ),
    ]


# domini che NON contiamo come "sito proprio"
BAD_DOMAINS = {
    "facebook.com", "www.facebook.com", "m.facebook.com",
    "instagram.com", "www.instagram.com",
    "linktr.ee", "www.linktr.ee",
    "justeat.it", "www.justeat.it",
    "deliveroo.it", "www.deliveroo.it",
    "glovoapp.com", "www.glovoapp.com",
    "thefork.it", "www.thefork.it",
    "tripadvisor.it", "www.tripadvisor.it",
    "google.com", "www.google.com",
    "sites.google.com",
}


def is_real_website(url: str) -> bool:
    url = (url or "").strip()
    if not url:
        return False

    try:
        host = (urlparse(url).netloc or "").lower()
        if not host:
            return False

        host_no_www = host[4:] if host.startswith("www.") else host

        if (
            host in BAD_DOMAINS
            or ("www." + host_no_www) in BAD_DOMAINS
            or host_no_www in BAD_DOMAINS
        ):
            return False

        return True
    except Exception:
        return False


@app.get("/search", response_model=List[PlaceOut])
def search(
    city: str = Query(..., example="Casarano"),
    category: str = Query(..., example="pizzeria"),
    only_without_site: bool = Query(True),
    limit: int = Query(10, ge=1, le=20),
):
    # Demo se manca key
    if not GOOGLE_API_KEY:
        data = demo(city, category)
        return [x for x in data if (x.website is None if only_without_site else True)]

    base = places_text_search(f"{category} {city}")

    status = base.get("status")
    err = base.get("error_message")
    n = len(base.get("results", []) or [])

    print("GOOGLE status:", status, "| error:", err, "| n:", n)

    # ✅ se Google non è OK, non torniamo [] in silenzio
    if status != "OK":
        raise HTTPException(
            status_code=400,
            detail={
                "google_status": status,
                "google_error_message": err,
                "query": f"{category} {city}",
            },
        )

    results = (base.get("results") or [])[:limit]
    enriched: List[PlaceOut] = []

    for r in results:
        pid = r.get("place_id")
        if not pid:
            continue

        det = place_details(pid).get("result", {})

        website = (det.get("website") or "").strip()
        website = website if website else None

        has_real_site = is_real_website(website)

        if only_without_site and has_real_site:
            continue

        enriched.append(
            PlaceOut(
                place_id=det.get("place_id", pid),
                name=det.get("name") or r.get("name"),
                address=det.get("formatted_address"),
                phone=det.get("formatted_phone_number"),
                rating=det.get("rating"),
                website=website,
            )
        )

    return enriched


# ==========================
# LEADS
# ==========================

@app.post("/leads", response_model=int)
def save_lead(lead: LeadIn):
    lead_id = upsert_lead({**lead.model_dump(), "status": "nuovo"})
    return lead_id


@app.get("/leads", response_model=List[LeadOut])
def get_leads(status: Optional[str] = None):
    return list_leads(status=status)


@app.patch("/leads/{lead_id}/status")
def patch_status(lead_id: int, payload: StatusPatch):
    status = payload.status.strip()
    if not status:
        raise HTTPException(status_code=400, detail="Status non valido")
    update_status(lead_id=lead_id, status=status)
    return {"ok": True}
