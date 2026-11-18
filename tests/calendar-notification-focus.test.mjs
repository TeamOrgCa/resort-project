import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const { focusCalendarNotification } = loadTsModule("lib/booking/calendar-notification-focus.ts");

test("calendar notification focus skips hidden responsive copies and centers the exact date's card", () => {
  const dom = new JSDOM('<div id="calendar"><button data-calendar-event="target:2027-03-28"></button><button data-calendar-event="other:2027-03-28"></button><button data-calendar-event="target:2027-03-29"></button><button data-calendar-event="target:2027-03-28"></button></div>');
  try {
    const root = dom.window.document.getElementById("calendar"), buttons = [...root.querySelectorAll("button")], scrolls = [];
    buttons.forEach((button, index) => {
      button.getClientRects = () => index === 0 ? [] : [{}];
      button.scrollIntoView = options => scrolls.push({ index, options });
    });
    assert.equal(focusCalendarNotification(root, "target", "2027-03-28"), true);
    assert.deepEqual(scrolls, [{ index: 3, options: { behavior: "smooth", block: "center", inline: "center" } }]);
    assert.equal(dom.window.document.activeElement, buttons[3]);
    assert.equal(focusCalendarNotification(root, "missing", "2027-03-28"), false);
    focusCalendarNotification(root, "target", "2027-03-28", true);
    assert.equal(scrolls.at(-1).options.behavior, "instant");
  } finally { dom.window.close(); }
});
