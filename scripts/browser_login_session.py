import argparse
import os
import sys
import time
from playwright.sync_api import sync_playwright

CHROME_EXEC = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
DEFAULT_PROFILE = r"D:\Auto3DvideoTools\browser_profile"

def launch_interactive_session(url="https://labs.google/fx/tools/flow", user_data_dir=DEFAULT_PROFILE):
    print(f"Launching Chrome via Playwright...")
    print(f"Profile directory: {user_data_dir}")
    print(f"Target URL: {url}")
    
    with sync_playwright() as p:
        browser_context = p.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            executable_path=CHROME_EXEC if os.path.exists(CHROME_EXEC) else None,
            headless=False,
            channel="chrome" if os.path.exists(CHROME_EXEC) else None,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--start-maximized"
            ],
            viewport=None
        )
        
        page = browser_context.pages[0] if browser_context.pages else browser_context.new_page()
        page.goto(url)
        print("Chrome window is opened. You can now log into your Google Account.")
        print("Waiting for browser to be closed by user...")
        
        try:
            while len(browser_context.pages) > 0:
                time.sleep(1)
        except Exception:
            pass
        print("Browser session closed. Profile credentials saved.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="https://labs.google/fx/tools/flow")
    parser.add_argument("--profile", default=DEFAULT_PROFILE)
    args = parser.parse_args()
    launch_interactive_session(args.url, args.profile)
