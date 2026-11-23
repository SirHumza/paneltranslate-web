"""Run from project root with the site served locally and Playwright Chromium installed."""
import os
from pathlib import Path
import json
import tempfile

from playwright.sync_api import sync_playwright

url = os.environ.get("PANELTRANSLATE_URL", "http://localhost:8000").rstrip("/")
with sync_playwright() as playwright, tempfile.TemporaryDirectory() as directory:
    browser = playwright.chromium.launch(executable_path=os.getenv("CHROME_BIN"))
    page = browser.new_page()
    page.goto(url)
    page.get_by_role("button", name="Try the Indonesian sample").click()
    page.locator("#run").click()
    page.wait_for_function("!document.querySelector('#run').disabled", timeout=300000)
    with page.expect_download() as download:
        page.locator("#saveJson").click()
    path = Path(directory) / "page.json"
    download.value.save_as(path)
    result = json.loads(path.read_text())
    assert (result["width"], result["height"]) == (1000, 700)
    assert len(result["regions"]) == 2 and not result["issues"], result
    first, second = result["regions"]
    assert "Hokkaido" in first["translation"]
    assert "friends" in second["translation"].lower()
    assert "hear" in second["translation"].lower() or "heard" in second["translation"].lower()
    with page.expect_download() as image:
        page.locator("#download").click()
    assert image.value.suggested_filename.endswith(".png")
    browser.close()
