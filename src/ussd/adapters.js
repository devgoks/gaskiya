// Screens are gateway-agnostic: {kind:'menu', title, items:[{key,label}]} | {kind:'input', message} | {kind:'end', message}
// Each adapter turns a screen into what one USSD gateway expects. Adding a gateway is
// one small function here, which is what lets the same app run in another country.

export function toQrios(screen, contextData = "gaskiya") {
  if (screen.kind === "menu") {
    return { action: { type: "ShowView", view: { type: "ChooserView", title: screen.title, items: screen.items.map((i) => ({ accessKey: i.key, label: i.label })) } }, contextData };
  }
  if (screen.kind === "input") {
    return { action: { type: "ShowView", view: { type: "InputView", message: screen.message } }, contextData };
  }
  return { action: { type: "ShowView", view: { type: "InfoView", message: screen.message } }, contextData };
}

// Africa's Talking style: plain text prefixed with CON (continue) or END.
export function toPlainText(screen) {
  if (screen.kind === "menu") return "CON " + renderMenu(screen);
  if (screen.kind === "input") return "CON " + screen.message;
  return "END " + screen.message;
}

export function renderMenu(screen) {
  return screen.title + "\n" + screen.items.map((i) => `${i.key} ${i.label}`).join("\n");
}

export function screenLength(screen) {
  if (screen.kind === "menu") return renderMenu(screen).length;
  return screen.message.length;
}
