import sqlite3
from typing import Optional, List, Dict

DB_PATH = "leads.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        place_id TEXT UNIQUE,
        name TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        rating REAL,
        website TEXT,
        city TEXT,
        category TEXT,
        status TEXT NOT NULL DEFAULT 'nuovo',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    """)
    conn.commit()
    conn.close()


def upsert_lead(payload: Dict) -> int:
    """
    Inserisce un lead se non esiste (place_id UNIQUE).
    Se esiste, aggiorna i campi base e ritorna l'id.
    """
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("SELECT id FROM leads WHERE place_id = ?", (payload["place_id"],))
    row = cur.fetchone()

    if row:
        lead_id = row["id"]
        cur.execute("""
            UPDATE leads
            SET name=?, address=?, phone=?, rating=?, website=?, city=?, category=?
            WHERE id=?
        """, (
            payload.get("name"),
            payload.get("address"),
            payload.get("phone"),
            payload.get("rating"),
            payload.get("website"),
            payload.get("city"),
            payload.get("category"),
            lead_id
        ))
    else:
        cur.execute("""
            INSERT INTO leads (place_id, name, address, phone, rating, website, city, category, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            payload.get("place_id"),
            payload.get("name"),
            payload.get("address"),
            payload.get("phone"),
            payload.get("rating"),
            payload.get("website"),
            payload.get("city"),
            payload.get("category"),
            payload.get("status", "nuovo"),
        ))
        lead_id = cur.lastrowid

    conn.commit()
    conn.close()
    return int(lead_id)


def list_leads(status: Optional[str] = None) -> List[Dict]:
    conn = get_conn()
    cur = conn.cursor()

    if status:
        cur.execute("SELECT * FROM leads WHERE status=? ORDER BY created_at DESC", (status,))
    else:
        cur.execute("SELECT * FROM leads ORDER BY created_at DESC")

    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def update_status(lead_id: int, status: str) -> None:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("UPDATE leads SET status=? WHERE id=?", (status, lead_id))
    conn.commit()
    conn.close()
