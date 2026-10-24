# Privacy / 隐私

Little Window has no server, analytics, telemetry, advertisements, or remote executable code.

The extension stores only the five most recent queries or URLs submitted through its own search box, the selected interface language, and the latest normal position and size of its launcher and browsing windows. These preferences use `chrome.storage.local`, not Chrome Sync. Temporary window identifiers use `chrome.storage.session`.

Recent entries can be removed individually or cleared in the launcher. Removing the extension removes its extension storage. It does not delete Chrome's separate browsing history, cookies, or website storage. Incognito use is disabled to prevent private queries from being saved accidentally.

Permissions:

- `search`: send submitted search text to your configured Chrome search engine.
- `storage`: retain the limited local data described above.

The extension does not request browsing-history, bookmarks, website-access, native-messaging, or content-script permissions. It does not read website contents or observe navigation inside a browsing window. Queries and visited websites are still processed by your chosen search engine and those websites, under their own privacy policies. Browsing windows share your existing Chrome profile, including normal login state and browser history. Closing a window is not private browsing.

---

Little Window 没有服务器、统计追踪、广告或远程代码。

插件仅在本机保存：最近 5 次从插件提交的搜索词或网址、界面语言、搜索框和网页小窗最近的普通状态位置与尺寸。不使用 Chrome 同步。临时窗口编号仅保存在当前浏览器会话中。

你可以单条删除记录或一键清空，卸载插件会删除插件存储。清空插件记录不会清除 Chrome 自身的浏览历史、Cookie 或网站数据。插件禁用无痕模式，以免意外保存隐私查询。

仅申请 `search` 和 `storage` 权限；不读取完整浏览历史、书签或网页内容，不监控网页小窗内后续访问的链接。搜索和网页仍使用你的默认搜索引擎及当前 Chrome 用户配置，正常使用登录状态并产生浏览历史。关闭小窗不等于无痕浏览。
