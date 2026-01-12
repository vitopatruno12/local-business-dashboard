import os
import requests
from typing import List, Dict, Optional

def _api_key() -> Optional[str]:
    return os.getenv("GOOGLE_API_KEY") or None

def demo_results(city: str, category: str) -> List[Dict]:
    # fallback se non hai la key: così React funziona subito
    return [
        {
            "place_id": "demo_p1",
            "name": f"{category.title()} Da Mario",
            "address": f"Via Roma 10, {city}",
            "phone": "+39 0833 000000",
            "rating": 4.4,
            "website": None,
        },
        {
            "place_id": "demo_p2",
            "name": f"{category.title()} Bella Napoli",
            "address": f"Corso Italia 22, {city}",
            "phone": "+39 0833 111111",
            "rating": 4.1,
            "website": "https://example.com",
        },
        {
            "place_id": "demo_p3",
            "name": f"{category.title()} Il Forno",
            "address": f"Via XX Settembre 5, {city}",
            "phone": None,
            "rating": 4.6,
            "website": None,
        },
    ]

def google_text_search(query: str, region: str = "it") -> List[Dict]:
    key = _api_key()
    if not key:
        return []

    url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
    params = {"query": query, "region": region, "key": key}
    r = requests.get(url, params=params, timeout=20)
    r.raise_for_status()
    return r.json().get("results", [])

def google_place_details(place_id: str) -> Dict:
    key = _api_key()
    if not key:
        return {}

    url = "https://maps.googleapis.com/maps/api/place/details/json"
    params = {
        "place_id": place_id,
        "fields": "place_id,name,formatted_address,formatted_phone_number,rating,website",
        "key": key,
    }
    r = requests.get(url, params=params, timeout=20)
    r.raise_for_status()
    return r.json().get("result", {})

def search_places(city: str, category: str, only_without_site: bool = True, limit: int = 10) -> List[Dict]:
    key = _api_key()
    if not key:
        # demo mode
        data = demo_results(city, category)
        return [x for x in data if (not x.get("website") if only_without_site else True)]

    base = google_text_search(f"{category} {city}")
    base = base[:limit]

    out: List[Dict] = []
    for item in base:
        pid = item.get("place_id")
        if not pid:
            continue

        det = google_place_details(pid)
        website = det.get("website")

        result = {
            "place_id": det.get("place_id", pid),
            "name": det.get("name", item.get("name")),
            "address": det.get("formatted_address"),
            "phone": det.get("formatted_phone_number"),
            "rating": det.get("rating"),
            "website": website,
        }

        if only_without_site and website:
            continue

        out.append(result)

    return out
