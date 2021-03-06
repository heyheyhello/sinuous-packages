// This support any Sinuous-like API
/* eslint-disable @typescript-eslint/no-explicit-any */
type API = {
  h: (...args: any[]) => unknown;
  add: (parent: Node, value: any, endMark?: Node) => unknown;
  insert: (el: Node, value: any, endMark?: Node, current?: any, startNode?: any) => unknown;
  property: (el: Node, value: any, name: string | null, isAttr?: boolean, isCss?: boolean) => void;
  rm: (parent: Node, startNode: any, endMark: Node) => void;
}

// Must be an interface; type doesn't work for module augmentation
interface RenderStackFrame { name: string }

type El = Element | Node | DocumentFragment
type InstanceMeta = RenderStackFrame

/** Functions write here during render. Data is moved to ds.meta after */
const stack: RenderStackFrame[] = [];
/** Connections between components (including guards) */
const tree: WeakMap<El, Set<El>> = new WeakMap();
/** Component metadata */
const meta: WeakMap<El, InstanceMeta> = new WeakMap();

// Note about the tree
// All connections between components and children are kept in tree. Elements
// that aren't components but have children who are must also be in the tree so
// the component children can be re-parented to a parent component later on.
// Every component is in the tree, even those with no children.

const emptyFn = () => {};
const tracers = {
  onCreate: emptyFn as (fn: () => El, el: El) => void,
  onAttach: emptyFn as (parent: El, child: El) => void,
  onDetach: emptyFn as (parent: El, child: El) => void,
};

const apiRef = {} as API;
/** Start tracing by modifying the Sinuous API */
const trace = (api: API): void => {
  Object.assign(apiRef, api);
  api.h = h;
  api.add = add;
  api.rm = rm;
};
trace.tracers = tracers;
trace.stack = stack;
trace.tree = tree;
trace.meta = meta;

// For sharing fragments between nested h() and add() calls
const refDF: DocumentFragment[] = [];

const searchForAdoptiveParent = (start: El) => {
  let cursor: El | null = start;
  // eslint-disable-next-line no-cond-assign
  while (cursor = cursor.parentElement)
    if (tree.has(cursor)) return cursor;
  // Else <body/>
  return document.body;
};

const h: typeof apiRef.h = (...args) => {
  const fn = args[0] as () => El;
  if (typeof fn !== 'function') {
    const retH = apiRef.h(...args);
    if (retH instanceof DocumentFragment) refDF.push(retH);
    return retH;
  }
  const renderData = { name: fn.name } as RenderStackFrame;
  stack.push(renderData);
  const el = apiRef.h(...args);
  stack.pop();

  // Not Element or DocumentFragment
  if (!(el instanceof Node)) return el;

  // Elements will already be in the tree if they had any children
  if (!tree.has(el)) tree.set(el, new Set<El>());

  // Register as a component
  meta.set(el, renderData);

  tracers.onCreate(fn, el);
  return el;
};

// Sinuous' api.add isn't purely a subcall of api.h. If given an array, it will
// call api.h again to create a fragment (never returned). To see the fragment
// here, tracer.h sets refDF. It's empty since insertBefore() clears child nodes
const add: typeof apiRef.add = (parent: El, value, endMark) => {
  const ret = apiRef.add(parent, value, endMark);
  if (Array.isArray(value) && refDF.length)
    value = refDF.pop() as DocumentFragment;
  if (!(value instanceof Node)) {
    return ret;
  }
  const parentChildren = tree.get(parent);
  const valueChildren = tree.get(value);
  // If <Any><-El, no action
  // If inTree<-Comp, parent also guards val
  // If inTree<-Guard, parent also guards val's children and val is no longer a guard
  // If El<-Comp, parent is now a guard of val
  // If El<-Guard, parent is now a guard of val's children and val is no longer a guard
  if (!valueChildren) return ret;

  const valueComp = meta.has(value);
  if (parentChildren) {
    if (valueComp)
      parentChildren.add(value);
    else
      valueChildren.forEach(x => parentChildren.add(x));
  } else {
    const children = valueComp ? new Set([value]) : valueChildren;
    if (!parent.parentElement || parent === document.body) {
      tree.set(parent, children);
    } else {
      // Value is being added to a connected tree. Look for a tree parent
      parent = searchForAdoptiveParent(parent);
      const parentChildren = tree.get(parent);
      if (parentChildren) children.forEach(c => parentChildren.add(c));
      else tree.set(parent, children); // parent === <body/>
    }
  }
  tracers.onAttach(parent, value);
  // Delete _after_ attaching. Value wasn't a component
  if (!valueComp) tree.delete(value);
  return ret;
};

const rm: typeof apiRef.rm = (parent, start, end) => {
  // Parent registered in the tree is possibly different than the DOM parent
  const treeParent = searchForAdoptiveParent(start as Node);
  const children = tree.get(treeParent);
  if (children)
    for (let c: Node | null = (start as Node); c && c !== end; c = c.nextSibling) {
      children.delete(c);
      tracers.onDetach(treeParent, c);
    }
  return apiRef.rm(parent, start, end);
};

type Trace = typeof trace;
export { RenderStackFrame, InstanceMeta, Trace, API }; // Types
export { trace };
