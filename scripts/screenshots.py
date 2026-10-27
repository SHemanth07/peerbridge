"""Capture the report screenshots (optional helper).

    pip install playwright && python -m playwright install chromium
    npm run dev           # in another terminal, DB seeded with the REAL embedding model
    python scripts/screenshots.py

Saves PNGs to docs/screenshots/.  Take them with the real model so the match scores are real.
"""
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "screenshots")
os.makedirs(OUT, exist_ok=True)

def shot(page, name, full=True):
    page.wait_for_timeout(900)
    page.screenshot(path=os.path.join(OUT, name), full_page=full)
    print("saved", name)

def login(ctx, email, pw):
    page = ctx.new_page()
    page.goto(BASE + "/login")
    page.fill('input[type=email]', email)
    page.fill('input[type=password]', pw)
    page.click("button")
    page.wait_for_url("**/dashboard**", timeout=15000) if "admin" not in email else page.wait_for_url("**/admin**", timeout=15000)
    return page

with sync_playwright() as p:
    b = p.chromium.launch()
    vp = {"width": 1280, "height": 900}

    # login page
    ctx = b.new_context(viewport=vp); pg = ctx.new_page(); pg.goto(BASE + "/login"); shot(pg, "01_login.png", False); ctx.close()

    # student: Aarav
    ctx = b.new_context(viewport=vp); pg = login(ctx, "aarav@student.edu", "Student@123")
    shot(pg, "02_dashboard.png")
    pg.goto(BASE + "/doubts"); shot(pg, "03_my_doubts.png")
    # open his first doubt (peers, learning path, similar doubts)
    pg.goto(BASE + "/doubts")
    pg.locator("table a").first.click(); pg.wait_for_timeout(2500); shot(pg, "04_doubt_matches.png")
    pg.goto(BASE + "/browse"); pg.fill("input[placeholder]", "deadlock"); pg.click("button:has-text('Search')"); shot(pg, "05_browse_keyword.png")
    pg.select_option("select", "semantic"); pg.fill("input[placeholder]", "how do I stop two programs from freezing each other"); pg.click("button:has-text('Search')"); pg.wait_for_timeout(1500); shot(pg, "06_browse_semantic.png")
    ctx.close()

    # student: Diya (helper side + sessions history)
    ctx = b.new_context(viewport=vp); pg = login(ctx, "diya@student.edu", "Student@123")
    pg.goto(BASE + "/expertise"); shot(pg, "07_expertise.png")
    pg.goto(BASE + "/sessions"); shot(pg, "08_sessions.png")
    ctx.close()

    # admin
    ctx = b.new_context(viewport=vp); pg = login(ctx, "admin@peerbridge.edu", "Admin@123")
    shot(pg, "09_admin_dashboard.png")
    ctx.close()
    b.close()
