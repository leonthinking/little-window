# Test coverage / 测试说明

Release candidate: **0.2.0**. Local validation date: **2026-10-24**.

Final local result: **16/16 unit tests and 18/18 real Chromium scenarios passed**, using Chrome for Testing **156.0.8078.4** on macOS. The ZIP package was generated from the tested source and its file list checked.

## Reproduce

```sh
npm ci
npx playwright install chromium
npm test
npm run test:e2e
npm run package
```

Use `npx playwright install --with-deps chromium` on Linux if browser system dependencies are missing. A compatible installed test browser can be selected with `CHROME_EXECUTABLE_PATH`. No browser profile or machine-specific path is committed.

## Automated coverage

The unit suite checks input parsing and unsafe schemes, credential URLs, history limit/deduplication/deletion/corrupt data, negative-display coordinates, offscreen recovery, launcher/browser ownership, stale window events, minimized/maximized bounds, old/new launcher coexistence, worker-state reconstruction, translations, manifest permissions, and text contrast.

The real Chromium suite checks extension loading and permissions; English/Chinese live switching; concurrent launcher requests; message-origin validation; error recovery; simulated IME composition; popup URL/default-engine navigation; profile website-storage sharing; five-item history and replay/delete/clear; HTML treated as text; independent saved geometry; Back navigation; session-state recovery; real service-worker suspension and wake-up; keyboard menu dismissal; offscreen creation fallback; and full browser restart persistence.

Browser tests use an isolated temporary profile and a local HTTP fixture. Search requests are intercepted to assert the exact Unicode query and default-engine routing without depending on an external search service. A navigation request accepted by Chrome counts as a recent lookup even when a remote page later fails to load.

Screenshots use synthetic demonstration lookups, not personal history. The test result JSON and screenshots are generated under ignored `test-results/`; only deliberate documentation screenshots are included in Git.

## Installed Chrome UI check

The installed v0.2.0 was reloaded and its version verified in ordinary Chrome on macOS. Through the real UI, the toolbar opened the search popup, English changed to Chinese, an HTTPS page opened in the same independent popup, Command-W closed that webpage window, and reopening showed the submitted lookup. Removing the test lookup returned the history list to its empty state. This check did not invoke a global shortcut.

## Review

Two independent reviewers examined backend state/concurrency and frontend/security/privacy. Confirmed issues were fixed and regression cases added: rejected offscreen creation and Escape behavior on the language selector. A separate restart experiment confirmed the tested Chromium restores ordinary windows but does not restore browsing popups after a clean shutdown; local preferences remain, session IDs reset.

## Explicit boundaries

Passing this suite does not certify every operating system or Chrome version. Real global shortcut registration, native IME candidate windows, macOS Spaces/fullscreen focus restoration, and physically connecting/disconnecting displays are not automated here. No user-assigned system or native Chrome shortcut was changed or tested for this release. Display edge cases are tested using geometry fixtures and Chrome's reported screen bounds.

Websites keep their own Escape behavior. Native titlebars and OS window-size restrictions remain under Chrome/macOS control. The extension does not provide incognito browsing.

## 中文说明

测试覆盖新增的中英双语、最近 5 条记录、两类窗口的独立位置和大小记忆，以及完整查询、打开、重开、删除、关闭流程。使用临时独立浏览器配置，不读取日常 Chrome 的数据。搜索服务使用拦截方式验证精确查询参数；截图均为虚构演示记录。

全局快捷键冲突、真实输入法候选框、macOS Spaces、物理显示器插拔仍依赖操作系统，不标为已实机验证。两路独立审查发现的问题修复后均补了回归检查。
