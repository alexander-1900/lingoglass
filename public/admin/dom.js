// Tiny DOM builder shared by the admin views. No innerHTML anywhere — every
// dynamic string lands in textContent or an attribute (A03), and the module
// performs no DOM access at import time, so Node (vitest) can import it.
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "text") node.textContent = String(value);
    else if (key === "class") node.className = String(value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key === "value" && (tag === "input" || tag === "textarea" || tag === "select")) {
      // Property, not attribute: <textarea value="…"> renders empty and a
      // <select value="…"> never selects its option when set as attributes.
      node.value = String(value);
    } else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    if (typeof child === "string") node.append(document.createTextNode(child));
    else node.append(child);
  }
  return node;
}
