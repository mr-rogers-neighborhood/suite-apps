/**
 * The smallest document the plain-DOM renderers need.
 *
 * The renderer is ES modules with no framework, so a test builds elements with the handful
 * of properties it sets. This helper is not a test itself; both renderer tests import it.
 */

export class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = [];
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.selected = false;
    this.required = false;
    this.maxLength = undefined;
    this.placeholder = "";
    this.type = "";
    this.name = "";
    this.tabIndex = undefined;
    this.id = "";
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, listener) {
    this.listeners.push([type, listener]);
  }

  /** Fire one listener the way a click, change, submit or keydown would. */
  fire(type, details = {}) {
    for (const [name, listener] of this.listeners) {
      if (name === type) listener({ type, target: this, preventDefault() {}, ...details });
    }
  }
}

export function findById(node, id) {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

export function findAll(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, out);
  return out;
}

/** Install a fake document with the given static ids. */
export function installDocument(ids) {
  const nodes = new Map(ids.map((id) => [id, new FakeNode(id)]));
  const root = nodes.values().next().value;
  globalThis.document = {
    createElement: (tag) => new FakeNode(tag),
    getElementById: (id) => nodes.get(id) ?? findById(root, id),
  };
  return { nodes, root };
}
