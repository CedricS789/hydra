const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "user-data"));
app.disableHardwareAcceleration();
const wait = async (predicate) => {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Picker interaction check timed out");
};
setTimeout(() => app.exit(1), 60000).unref();
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    await win.loadFile(path.join(__dirname, "renderer/index.html"));
    const js = (code) => win.webContents.executeJavaScript(code);
    await wait(() => js("Boolean(window.releasePickerTest)"));
    const calls = () => js("window.releasePickerTest.snapshot()");
    const configure = async (mode, browsing = true) => {
      await js(
        `window.releasePickerTest.configure(${JSON.stringify(mode)},${browsing})`
      );
      await wait(() =>
        js(
          `document.querySelector('main').dataset.mode===${JSON.stringify(mode)} && document.querySelector('main').dataset.browsing===${JSON.stringify(String(browsing))}`
        )
      );
    };
    const card = () =>
      js("document.querySelector('.repacks-modal__repack-button').click()");
    const openMenu = async () => {
      await js(
        "document.querySelector('.repacks-modal__repack-button').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}))"
      );
      await wait(() => js("Boolean(document.querySelector('[role=menu]'))"));
    };
    assert.equal(
      await js("document.querySelector('main').dataset.mode"),
      "native"
    );
    await card();
    assert.equal((await calls()).downloads, 1);
    await configure("menu");
    await openMenu();
    assert.equal((await calls()).downloads, 0);
    const labels = await js(
      "[...document.querySelectorAll('[role=menuitem]')].map(e=>e.textContent)"
    );
    assert.deepEqual(labels, [
      "View source website",
      "Download options in Hydra…",
    ]);
    await js(
      "[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.includes('Download options')).click()"
    );
    await wait(async () => (await calls()).downloads === 1);
    await configure("native");
    await configure("menu");
    await openMenu();
    await js(
      "[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.includes('View source')).click()"
    );
    await wait(async () => (await calls()).browsers === 1);
    assert.equal((await calls()).downloads, 0);
    await configure("native");
    await configure("menu");
    await js(
      "document.querySelector('.repacks-modal__repack-button').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))"
    );
    await wait(() => js("Boolean(document.querySelector('[role=menu]'))"));
    await js(
      "document.querySelector('[role=menu]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"
    );
    await wait(() => js("!document.querySelector('[role=menu]')"));
    assert.equal((await calls()).downloads, 0);
    await configure("website-only");
    assert.equal(
      await js(
        "Boolean(document.querySelector('button.repacks-modal__repack-button'))"
      ),
      false
    );
    await js("document.querySelector('.repacks-modal__repack-static').click()");
    assert.equal((await calls()).downloads, 0);
    await js(
      "[...document.querySelectorAll('button')].find(e=>e.textContent==='View source').click()"
    );
    await wait(async () => (await calls()).browsers === 1);
    assert.equal((await calls()).downloads, 0);
    await configure("website-only", false);
    assert.equal(await js("document.querySelectorAll('button').length"), 0);
    assert.ok(
      await js(
        "document.body.textContent.includes('Source browsing is disabled')"
      )
    );
    await configure("native", false);
    await card();
    assert.equal((await calls()).downloads, 1);
    await configure("menu", false);
    await openMenu();
    assert.equal(
      await js("document.querySelectorAll('[role=menuitem]').length"),
      1
    );
    assert.equal((await calls()).downloads, 0);
    console.log(
      "Release picker UI checks passed: native default, action menus, website-only cards, and browsing-disabled behavior."
    );
    win.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
