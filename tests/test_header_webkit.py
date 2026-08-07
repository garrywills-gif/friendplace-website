"""
iter157 Safari-header regression test.
Verifies:
  1. WebKit hit-tests every header nav link at its centre point.
  2. 7-click stress test (About → How It Works → Features → Events →
     Stories → FAQs → Contact) with return-to-home between each never
     drops a click.
  3. Logo still hit-tests correctly after the stress sequence.
  4. #fp-brand-butterfly rect is still viewport-relative (not zeroed
     by isolation/transform on the header).
"""
import time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3001"
LINKS = [
    ("/", "logo"),
    ("/about", "about"),
    ("/how-it-works", "how-it-works"),
    ("/features", "features"),
    ("/events", "events"),
    ("/success-stories", "stories"),
    ("/faqs", "faqs"),
    ("/contact", "contact"),
]

def hit_test(page, href):
    """Return (ok, actual_href) — clicks-at-centre returns expected <a>."""
    result = page.evaluate("""(href) => {
        const sel = href === '/' 
          ? "header a[href='/']:has(img#fp-brand-butterfly)" 
          : `header a[href='${href}']`;
        const a = document.querySelector(sel);
        if (!a) return { ok: false, reason: 'selector missed', actual: null, x:0, y:0 };
        const r = a.getBoundingClientRect();
        const x = Math.round(r.left + r.width/2);
        const y = Math.round(r.top + r.height/2);
        let el = document.elementFromPoint(x, y);
        // walk up to <a>
        let anchor = el;
        while (anchor && anchor.tagName !== 'A') anchor = anchor.parentElement;
        const actualHref = anchor ? anchor.getAttribute('href') : null;
        return {
          ok: actualHref === href,
          actual: actualHref,
          expected: href,
          x, y,
          rect: {top:r.top, left:r.left, w:r.width, h:r.height},
          tag: el ? el.tagName : null,
          elCls: el ? el.className : null,
        };
    }""", href)
    return result

def main():
    results = {"hit_tests": [], "click_sequence": [], "butterfly_rect": None,
               "final_logo_hit_test": None, "errors": []}
    with sync_playwright() as p:
        browser = p.webkit.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.on("pageerror", lambda e: results["errors"].append(f"pageerror: {e}"))

        # 1) Load home + verify header
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_selector("header a[href='/about']", timeout=10000)

        # 2) hit-test each anchor
        for href, name in LINKS:
            r = hit_test(page, href)
            print(f"HIT {name} ({href}): ok={r['ok']} actual={r.get('actual')} @({r.get('x')},{r.get('y')})")
            results["hit_tests"].append({"name": name, "href": href, **r})

        # 3) butterfly rect check
        rect = page.evaluate("""() => {
            const el = document.getElementById('fp-brand-butterfly');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {top:r.top, left:r.left, width:r.width, height:r.height,
                    right:r.right, bottom:r.bottom};
        }""")
        results["butterfly_rect"] = rect
        print(f"BUTTERFLY rect: {rect}")

        # 4) 7-click stress
        stress = ["/about","/how-it-works","/features","/events",
                  "/success-stories","/faqs","/contact"]
        for target in stress:
            sel = f"header a[href='{target}']"
            try:
                page.click(sel, timeout=5000)
                page.wait_for_url(f"**{target}", timeout=5000)
                url_after = page.url
                nav_ok = url_after.endswith(target) or target in url_after
                print(f"CLICK {target}: ok={nav_ok} url={url_after}")
                results["click_sequence"].append({"target": target, "ok": nav_ok, "url_after": url_after})
                page.wait_for_timeout(800)
                # back to /
                page.goto(BASE + "/", wait_until="domcontentloaded")
                page.wait_for_selector("header a[href='/about']", timeout=5000)
            except Exception as e:
                print(f"CLICK {target}: FAILED {e}")
                results["click_sequence"].append({"target": target, "ok": False, "error": str(e)})

        # 5) final logo hit test
        r = hit_test(page, "/")
        results["final_logo_hit_test"] = r
        print(f"FINAL LOGO hit-test: ok={r['ok']} actual={r.get('actual')}")
        # click logo, navigate to /
        try:
            page.click("header a[href='/']:has(img#fp-brand-butterfly)", timeout=5000)
            page.wait_for_timeout(600)
            results["final_logo_click_url"] = page.url
            print(f"FINAL LOGO click url: {page.url}")
        except Exception as e:
            results["final_logo_click_url"] = f"ERR: {e}"
            print(f"FINAL LOGO click FAILED: {e}")

        browser.close()

    # Summary
    hit_pass = sum(1 for r in results["hit_tests"] if r["ok"])
    click_pass = sum(1 for r in results["click_sequence"] if r.get("ok"))
    print("\n===SUMMARY===")
    print(f"Hit tests: {hit_pass}/{len(results['hit_tests'])}")
    print(f"Clicks:    {click_pass}/{len(results['click_sequence'])}")
    print(f"Final logo hit: {results['final_logo_hit_test']['ok']}")
    print(f"Butterfly rect: {results['butterfly_rect']}")
    print(f"Errors: {results['errors']}")
    return results

if __name__ == "__main__":
    main()
