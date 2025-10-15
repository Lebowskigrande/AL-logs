# Dashboard Screenshot Capture

This document describes how to reproduce the desktop dashboard screenshot that accompanies the current layout review.

1. Start a local static server from the project root:
   ```bash
   python3 -m http.server 8000
   ```
2. With the server running, open a separate shell and launch the Playwright helper to capture the desktop viewport:
   ```bash
   python3 - <<'PY'
   import asyncio
   from playwright.async_api import async_playwright

   async def main():
       async with async_playwright() as p:
           browser = await p.chromium.launch()
           page = await browser.new_page(viewport={"width": 1440, "height": 900})
           await page.goto('http://127.0.0.1:8000/index.html', wait_until='networkidle')
           await page.wait_for_timeout(2000)
           await page.screenshot(path='dashboard.png', full_page=True)
           await browser.close()

   asyncio.run(main())
   PY
   ```
3. The screenshot will be written to `dashboard.png` in the working directory. Attach or archive it as needed for reviews.

The 1440×900 viewport ensures the desktop-only sidebars are visible while keeping the log list readable in a single image.
