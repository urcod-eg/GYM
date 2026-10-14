/**
 * A small Firestore Security Rules simulator for running the rules tests where the official
 * emulator (Java) cannot be downloaded. It parses firestore.rules with Firebase's own ANTLR grammar
 * (from @firebase/eslint-plugin-security-rules, Apache-2.0, copied into ./grammar) and evaluates
 * the rules for single reads and atomic batched writes.
 *
 * It is a second opinion, not a replacement: the official emulator stays the reference
 * (`npm run test:rules`, also run in CI). Known simplifications:
 *   - `list` is checked per returned document, not against the query's constraints.
 *   - Only the functions and methods these rules use are implemented; anything else throws
 *     loudly so a gap is never mistaken for a denial.
 *   - Integers and floats are both JS numbers (`is int` means Number.isInteger).
 */
import { createHash } from 'node:crypto';
import * as antlrNs from 'antlr4';

// The generated grammar is plain JavaScript in .ts files (@ts-nocheck). It is loaded through a
// non-literal specifier so the type checker does not walk into it, and used untyped.
/* eslint-disable @typescript-eslint/no-explicit-any */
const antlr4: any = (antlrNs as any).default ?? antlrNs;
const GRAMMAR = './grammar/';
const { default: Lexer } = await import(/* @vite-ignore */ `${GRAMMAR}FirebaseRulesLexer.ts`);
const { default: Parser } = await import(/* @vite-ignore */ `${GRAMMAR}FirebaseRulesParser.ts`);

// ------------------------------------------------------------------ values

export class RMap {
  constructor(public readonly m: Map<string, RV>) {}
  static of(o: Record<string, RV>) {
    return new RMap(new Map(Object.entries(o)));
  }
}
export class RSet {
  constructor(public readonly items: RV[]) {}
}
export class RTime {
  constructor(public readonly ms: number) {}
}
export class RDur {
  constructor(public readonly ms: number) {}
}
export class RPath {
  constructor(public readonly s: string) {}
}
export class RBytes {
  constructor(public readonly buf: Buffer) {}
}
export class RDiff {
  constructor(public readonly a: RMap, public readonly b: RMap) {}
}
export type RV = null | boolean | number | string | RV[] | RMap | RSet | RTime | RDur | RPath | RDiff | RBytes;

/** Evaluation error: makes the surrounding condition fail (unless || / && can decide without it). */
export class RErr extends Error {}
/** A missing simulator feature. Never swallowed: the test fails and says what is missing. */
export class SimGap extends Error {}

const fail = (msg: string): never => {
  throw new RErr(msg);
};

function typeOf(v: RV): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v)) return 'list';
  if (v instanceof RMap) return 'map';
  if (v instanceof RSet) return 'set';
  if (v instanceof RTime) return 'timestamp';
  if (v instanceof RDur) return 'duration';
  if (v instanceof RPath) return 'path';
  if (v instanceof RDiff) return 'map_diff';
  if (v instanceof RBytes) return 'bytes';
  return 'unknown';
}

export function eq(a: RV, b: RV): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => eq(x, (b as RV[])[i]));
  if (a instanceof RMap) {
    if (!(b instanceof RMap) || a.m.size !== b.m.size) return false;
    for (const [k, v] of a.m) if (!b.m.has(k) || !eq(v, b.m.get(k)!)) return false;
    return true;
  }
  if (a instanceof RSet) return b instanceof RSet && a.items.length === b.items.length && a.items.every((x) => b.items.some((y) => eq(x, y)));
  if (a instanceof RTime) return b instanceof RTime && a.ms === b.ms;
  if (a instanceof RDur) return b instanceof RDur && a.ms === b.ms;
  if (a instanceof RPath) return b instanceof RPath && a.s === b.s;
  if (a instanceof RBytes) return b instanceof RBytes && a.buf.equals(b.buf);
  return false;
}

const uniq = (xs: RV[]) => xs.filter((x, i) => xs.findIndex((y) => eq(x, y)) === i);
const contains = (xs: RV[], v: RV) => xs.some((x) => eq(x, v));
const asBool = (v: RV): boolean => (typeof v === 'boolean' ? v : fail(`expected bool, got ${typeOf(v)}`));

// ------------------------------------------------------------------ AST

type Node =
  | { t: 'lit'; v: RV }
  | { t: 'var'; name: string }
  | { t: 'member'; obj: Node; name: string }
  | { t: 'index'; obj: Node; idx: Node }
  | { t: 'call'; name: string; args: Node[] }
  | { t: 'mcall'; obj: Node; name: string; args: Node[] }
  | { t: 'nscall'; ns: string; name: string; args: Node[] }
  | { t: 'list'; items: Node[] }
  | { t: 'map'; entries: [Node, Node][] }
  | { t: 'path'; segs: (string | Node)[] }
  | { t: 'bin'; op: string; l: Node; r: Node }
  | { t: 'is'; e: Node; type: string }
  | { t: 'not'; e: Node }
  | { t: 'neg'; e: Node }
  | { t: 'tern'; c: Node; a: Node; b: Node };

interface FnDecl {
  name: string;
  params: string[];
  lets: [string, Node][];
  ret: Node;
}
type Seg = { kind: 'lit'; s: string } | { kind: 'cap'; name: string } | { kind: 'glob'; name: string };
interface Allow {
  methods: string[];
  cond: Node | null;
}
interface MatchBlock {
  segs: Seg[];
  fns: FnDecl[];
  allows: Allow[];
  children: MatchBlock[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ctx = any;
const kind = (c: Ctx): string => (c.symbol ? 'TOKEN' : c.constructor.name.replace(/Context$/, ''));
const kids = (c: Ctx): Ctx[] => c.children ?? [];
const ruleKids = (c: Ctx) => kids(c).filter((k) => !k.symbol);
const text = (c: Ctx): string => c.getText();

function unquote(s: string): string {
  const body = s.slice(1, -1);
  return body.replace(/\\(.)/g, (_, ch: string) => ({ n: '\n', t: '\t', r: '\r' })[ch as 'n'] ?? ch);
}

function literal(s: string): RV {
  if (s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s.startsWith("'") || s.startsWith('"')) return unquote(s);
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?[\d.]+(e[+-]?\d+)?$/i.test(s)) return parseFloat(s);
  throw new SimGap(`literal ${s}`);
}

function exprList(c: Ctx | undefined): Node[] {
  if (!c) return [];
  return ruleKids(c).map(expr);
}

function expr(c: Ctx): Node {
  const k = kind(c);
  const ch = kids(c);
  switch (k) {
    case 'PrimaryExpression':
    case 'IndexLookup':
      return expr(ruleKids(c)[0]);
    case 'ParenSimpleExpression':
      return expr(ruleKids(c)[0]);
    case 'LiteralExpression':
      return { t: 'lit', v: literal(text(c)) };
    case 'VariableSimpleExpression':
      return { t: 'var', name: text(c) };
    case 'MemberLookupSimpleExpression':
      return { t: 'member', obj: expr(ch[0]), name: text(ch[2]) };
    case 'ListLookupSimpleExpression':
      if (kind(ch[2]) !== 'IndexLookup') throw new SimGap('range lookup');
      return { t: 'index', obj: expr(ch[0]), idx: expr(ch[2]) };
    case 'FunctionCallSimpleExpression':
      return { t: 'call', name: text(ch[0]), args: exprList(ch.find((x: Ctx) => kind(x) === 'ExpressionList')) };
    case 'MemberFunctionCallSimpleExpression':
      return { t: 'mcall', obj: expr(ch[0]), name: text(ch[2]), args: exprList(ch.find((x: Ctx) => kind(x) === 'ExpressionList')) };
    case 'IdMemberFunctionCallSimpleExpression':
      return { t: 'nscall', ns: text(ch[0]), name: text(ch[2]), args: exprList(ch.find((x: Ctx) => kind(x) === 'ExpressionList')) };
    case 'ListSimpleExpression':
      return { t: 'list', items: exprList(ch.find((x: Ctx) => kind(x) === 'ExpressionList')) };
    case 'MapSimpleExpression': {
      const entriesCtx = ruleKids(ch[0]).find((x: Ctx) => kind(x) === 'MapEntries');
      const entries: [Node, Node][] = entriesCtx ? ruleKids(entriesCtx).map((e: Ctx) => [expr(ruleKids(e)[0]), expr(ruleKids(e)[1])] as [Node, Node]) : [];
      return { t: 'map', entries };
    }
    case 'PathSimpleExpression': {
      const segs: (string | Node)[] = [];
      for (const s of ruleKids(ruleKids(c)[0])) {
        const inner = ruleKids(s);
        if (inner.length === 1 && kind(inner[0]) === 'SimpleSegmemnt') segs.push(text(inner[0]).replace(/^\//, ''));
        else if (inner.length === 1) segs.push(expr(inner[0]));
        else throw new SimGap('path segment');
      }
      return { t: 'path', segs };
    }
    case 'AdditiveExpression':
    case 'MultiplicativeExpression':
    case 'RelationalExpression':
    case 'EqualityExpression':
    case 'LogicalAndExpression':
    case 'LogicalOrExpression':
    case 'ExprInExpression':
      return { t: 'bin', op: text(ch[1]), l: expr(ch[0]), r: expr(ch[2]) };
    case 'ExprIsTypeIdExpression':
      return { t: 'is', e: expr(ch[0]), type: text(ch[2]) };
    case 'NotExpression':
      return { t: 'not', e: expr(ch[1]) };
    case 'UnaryAdditiveExpression':
      if (text(ch[0]) !== '-') throw new SimGap('unary +');
      return { t: 'neg', e: expr(ch[1]) };
    case 'TernaryExpression':
      return { t: 'tern', c: expr(ch[0]), a: expr(ch[2]), b: expr(ch[4]) };
    default:
      throw new SimGap(`expression ${k}`);
  }
}

function fnDecl(c: Ctx): FnDecl {
  const ch = ruleKids(c);
  const name = text(ch[0]);
  const plist = ruleKids(ch[1])[0];
  const params = plist ? ruleKids(plist).map(text) : [];
  const body = ruleKids(ch[2]);
  const lets: [string, Node][] = [];
  let ret: Node | null = null;
  for (const s of body) {
    if (kind(s) === 'BindingDeclaration') lets.push([text(ruleKids(s)[0]), expr(ruleKids(s)[1])]);
    else if (kind(s) === 'ReturnStatement') ret = expr(ruleKids(s)[0]);
  }
  if (!ret) throw new SimGap(`function ${name} without return`);
  return { name, params, lets, ret };
}

function pathDecl(c: Ctx): Seg[] {
  return ruleKids(c).map((s: Ctx): Seg => {
    const k = kind(s);
    if (k === 'SimpleSegmemnt') return { kind: 'lit', s: text(s).replace(/^\//, '') };
    if (k === 'CaptureSegment') return { kind: 'cap', name: text(ruleKids(ruleKids(s)[0])[0]) };
    if (k === 'GlobSegment') return { kind: 'glob', name: text(ruleKids(ruleKids(s)[0])[0]) };
    throw new SimGap(`path decl ${k}`);
  });
}

function matchBlock(c: Ctx): MatchBlock {
  const ch = ruleKids(c);
  const block: MatchBlock = { segs: pathDecl(ch[0]), fns: [], allows: [], children: [] };
  for (const st of ch.slice(1)) collect(st, block);
  return block;
}

function collect(st: Ctx, into: MatchBlock) {
  const inner = kind(st) === 'MatchStatement' || kind(st) === 'ServiceStatement' ? ruleKids(st)[0] : st;
  const k = kind(inner);
  if (k === 'FunctionDeclaration') into.fns.push(fnDecl(inner));
  else if (k === 'MatchRuleDeclaration') into.children.push(matchBlock(inner));
  else if (k === 'PermissionDeclaration') {
    const parts = ruleKids(inner);
    const methods = ruleKids(parts[0]).map(text);
    const body = parts[1];
    into.allows.push({ methods, cond: body ? expr(ruleKids(body)[0]) : null });
  } else throw new SimGap(`statement ${k}`);
}

export function parseRules(src: string): MatchBlock {
  const lexer = new Lexer(new antlr4.InputStream(src));
  const parser = new Parser(new antlr4.CommonTokenStream(lexer));
  const errors: string[] = [];
  parser.removeErrorListeners();
  class Collect extends antlr4.error.ErrorListener {
    syntaxError(_r: unknown, _s: unknown, line: number, col: number, msg: string) {
      errors.push(`${line}:${col} ${msg}`);
    }
  }
  parser.addErrorListener(new Collect());
  const tree = parser.ruleset();
  if (errors.length) throw new Error(`rules syntax: ${errors.join('; ')}`);
  const root: MatchBlock = { segs: [], fns: [], allows: [], children: [] };
  for (const rs of ruleKids(tree)) {
    if (kind(rs) !== 'RulesetStatement') continue;
    const svc = ruleKids(rs)[0];
    if (text(ruleKids(svc)[0]) !== 'cloud.firestore') continue;
    for (const st of ruleKids(svc).slice(1)) collect(st, root);
  }
  return root;
}

// ------------------------------------------------------------------ evaluation

export interface DocStore {
  get(path: string): Record<string, unknown> | undefined;
}

export interface EvalContext {
  request: RV;
  resource: RV;
  before: DocStore;
  after: DocStore;
  now: number;
  /** Distinct document lookups made by get/exists (before) and getAfter/existsAfter (after). */
  lookups: Set<string>;
}

type Frame = { vars: Map<string, RV | RErr>; fnScope: MatchScope };
interface MatchScope {
  fns: FnDecl[];
  vars: Map<string, RV>;
  parent: MatchScope | null;
}

const DB_PREFIX = '/databases/(default)/documents/';

/** Converts stored JS values (Date, objects, arrays) into rules values. */
export function toRV(v: unknown): RV {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return new RTime(v.getTime());
  if (Array.isArray(v)) return v.map(toRV);
  if (typeof v === 'object') return new RMap(new Map(Object.entries(v as object).map(([k, x]) => [k, toRV(x)])));
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  throw new SimGap(`stored value ${typeof v}`);
}

export function resourceOf(path: string, data: Record<string, unknown> | undefined): RV {
  if (!data) return null;
  return RMap.of({ data: toRV(data), id: path.split('/').pop()!, __name__: new RPath(DB_PREFIX + path) });
}

function docPathFrom(p: RV): string {
  if (!(p instanceof RPath)) fail('get() needs a path');
  const s = (p as RPath).s;
  if (!s.startsWith(DB_PREFIX)) fail(`path outside the database: ${s}`);
  return s.slice(DB_PREFIX.length);
}

function lookupFn(scope: MatchScope | null, name: string): [FnDecl, MatchScope] | null {
  for (let s = scope; s; s = s.parent) {
    const f = s.fns.find((x) => x.name === name);
    if (f) return [f, s];
  }
  return null;
}

function lookupVar(frame: Frame, name: string, ctx: EvalContext): RV {
  if (frame.vars.has(name)) {
    const v = frame.vars.get(name)!;
    if (v instanceof RErr) throw v;
    return v;
  }
  for (let s: MatchScope | null = frame.fnScope; s; s = s.parent) if (s.vars.has(name)) return s.vars.get(name)!;
  if (name === 'request') return ctx.request;
  if (name === 'resource') return ctx.resource;
  if (name === 'database') return '(default)';
  throw new SimGap(`unknown variable ${name}`);
}

function member(v: RV, name: string): RV {
  if (v instanceof RMap) return v.m.has(name) ? v.m.get(name)! : fail(`missing key ${name}`);
  return fail(`.${name} on ${typeOf(v)}`);
}

function evalNode(n: Node, f: Frame, ctx: EvalContext): RV {
  switch (n.t) {
    case 'lit':
      return n.v;
    case 'var':
      return lookupVar(f, n.name, ctx);
    case 'member':
      return member(evalNode(n.obj, f, ctx), n.name);
    case 'index': {
      const o = evalNode(n.obj, f, ctx);
      const i = evalNode(n.idx, f, ctx);
      if (o instanceof RMap && typeof i === 'string') return o.m.has(i) ? o.m.get(i)! : fail(`missing key ${i}`);
      if (Array.isArray(o) && typeof i === 'number') return i >= 0 && i < o.length ? o[i] : fail('index out of range');
      return fail('bad index');
    }
    case 'list':
      return n.items.map((x) => evalNode(x, f, ctx));
    case 'map': {
      const m = new Map<string, RV>();
      for (const [k, v] of n.entries) {
        const kv = evalNode(k, f, ctx);
        if (typeof kv !== 'string') fail('map keys must be strings');
        m.set(kv as string, evalNode(v, f, ctx));
      }
      return new RMap(m);
    }
    case 'path': {
      const parts = n.segs.map((s) => {
        if (typeof s === 'string') return s;
        const v = evalNode(s, f, ctx);
        if (typeof v === 'string') return v;
        if (typeof v === 'number') return String(v);
        return fail(`path segment must be a string, got ${typeOf(v)}`);
      });
      if (parts.some((p) => p === '' || p.includes('/'))) fail('bad path segment');
      return new RPath('/' + parts.join('/'));
    }
    case 'not':
      return !asBool(evalNode(n.e, f, ctx));
    case 'neg': {
      const v = evalNode(n.e, f, ctx);
      return typeof v === 'number' ? -v : fail('negate non-number');
    }
    case 'tern':
      return asBool(evalNode(n.c, f, ctx)) ? evalNode(n.a, f, ctx) : evalNode(n.b, f, ctx);
    case 'is':
      return isType(evalNode(n.e, f, ctx), n.type);
    case 'bin':
      return binary(n, f, ctx);
    case 'call':
      return call(n.name, n.args, f, ctx);
    case 'nscall':
      // `x.f()` where x is a plain identifier parses the same way as `duration.value()`.
      if (!['duration', 'timestamp', 'math', 'hashing', 'latlng'].includes(n.ns)) return method(lookupVar(f, n.ns, ctx), n.name, n.args.map((a) => evalNode(a, f, ctx)));
      return nsCall(n.ns, n.name, n.args.map((a) => evalNode(a, f, ctx)));
    case 'mcall':
      return method(evalNode(n.obj, f, ctx), n.name, n.args.map((a) => evalNode(a, f, ctx)));
  }
}

function isType(v: RV, t: string): boolean {
  const ty = typeOf(v);
  switch (t) {
    case 'number':
      return ty === 'int' || ty === 'float';
    case 'float':
      return typeof v === 'number';
    case 'bool':
    case 'int':
    case 'string':
    case 'list':
    case 'map':
    case 'set':
    case 'timestamp':
    case 'duration':
    case 'path':
      return ty === t;
    default:
      throw new SimGap(`is ${t}`);
  }
}

function binary(n: Extract<Node, { t: 'bin' }>, f: Frame, ctx: EvalContext): RV {
  if (n.op === '||' || n.op === '&&') {
    const decisive = n.op === '||';
    let left: boolean | RErr;
    try {
      left = asBool(evalNode(n.l, f, ctx));
    } catch (e) {
      if (!(e instanceof RErr)) throw e;
      left = e;
    }
    if (left === decisive) return decisive;
    const right = asBool(evalNode(n.r, f, ctx));
    if (left instanceof RErr) {
      if (right === decisive) return decisive;
      throw left;
    }
    return right;
  }
  const l = evalNode(n.l, f, ctx);
  const r = evalNode(n.r, f, ctx);
  switch (n.op) {
    case '==':
      return eq(l, r);
    case '!=':
      return !eq(l, r);
    case 'in':
      if (Array.isArray(r)) return contains(r, l);
      if (r instanceof RSet) return contains(r.items, l);
      if (r instanceof RMap) return typeof l === 'string' && r.m.has(l);
      return fail('in on non-collection');
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const c = compare(l, r);
      return n.op === '<' ? c < 0 : n.op === '<=' ? c <= 0 : n.op === '>' ? c > 0 : c >= 0;
    }
    case '+':
      if (typeof l === 'number' && typeof r === 'number') return l + r;
      if (typeof l === 'string' && typeof r === 'string') return l + r;
      if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
      if (l instanceof RTime && r instanceof RDur) return new RTime(l.ms + r.ms);
      if (l instanceof RDur && r instanceof RTime) return new RTime(l.ms + r.ms);
      if (l instanceof RDur && r instanceof RDur) return new RDur(l.ms + r.ms);
      return fail(`+ on ${typeOf(l)} and ${typeOf(r)}`);
    case '-':
      if (typeof l === 'number' && typeof r === 'number') return l - r;
      if (l instanceof RTime && r instanceof RDur) return new RTime(l.ms - r.ms);
      if (l instanceof RTime && r instanceof RTime) return new RDur(l.ms - r.ms);
      return fail('- on these types');
    case '*':
      return typeof l === 'number' && typeof r === 'number' ? l * r : fail('*');
    case '/':
      return typeof l === 'number' && typeof r === 'number' && r !== 0 ? (Number.isInteger(l) && Number.isInteger(r) ? Math.trunc(l / r) : l / r) : fail('/');
    case '%':
      return typeof l === 'number' && typeof r === 'number' && r !== 0 ? l % r : fail('%');
    default:
      throw new SimGap(`operator ${n.op}`);
  }
}

function compare(l: RV, r: RV): number {
  if (typeof l === 'number' && typeof r === 'number') return l - r;
  if (typeof l === 'string' && typeof r === 'string') return l < r ? -1 : l > r ? 1 : 0;
  if (l instanceof RTime && r instanceof RTime) return l.ms - r.ms;
  if (l instanceof RDur && r instanceof RDur) return l.ms - r.ms;
  return fail(`compare ${typeOf(l)} with ${typeOf(r)}`);
}

function call(name: string, argNodes: Node[], f: Frame, ctx: EvalContext): RV {
  const user = lookupFn(f.fnScope, name);
  if (user) {
    const [fn, scope] = user;
    if (fn.params.length !== argNodes.length) fail(`${name}: wrong arg count`);
    const vars = new Map<string, RV | RErr>();
    fn.params.forEach((p, i) => vars.set(p, evalNode(argNodes[i], f, ctx)));
    const frame: Frame = { vars, fnScope: scope };
    for (const [k, e] of fn.lets) {
      try {
        vars.set(k, evalNode(e, frame, ctx));
      } catch (err) {
        if (!(err instanceof RErr)) throw err;
        vars.set(k, err); // only fails if used, like a lazy binding
      }
    }
    return evalNode(fn.ret, frame, ctx);
  }
  const args = argNodes.map((a) => evalNode(a, f, ctx));
  const lookup = (after: boolean) => {
    const p = docPathFrom(args[0]);
    ctx.lookups.add(`${after ? 'after' : 'before'}:${p}`);
    return { p, doc: (after ? ctx.after : ctx.before).get(p) };
  };
  switch (name) {
    case 'get': {
      const { p, doc } = lookup(false);
      return resourceOf(p, doc);
    }
    case 'getAfter': {
      const { p, doc } = lookup(true);
      return resourceOf(p, doc);
    }
    case 'exists':
      return !!lookup(false).doc;
    case 'existsAfter':
      return !!lookup(true).doc;
    case 'string':
      if (args[0] === null) return 'null';
      if (typeof args[0] === 'number' || typeof args[0] === 'boolean' || typeof args[0] === 'string') return String(args[0]);
      return fail('string() of this type');
    case 'int':
      return typeof args[0] === 'number' ? Math.trunc(args[0]) : typeof args[0] === 'string' && /^-?\d+$/.test(args[0]) ? parseInt(args[0], 10) : fail('int()');
    case 'path':
      return typeof args[0] === 'string' ? new RPath(args[0]) : fail('path()');
    case 'debug':
      return args[0];
    default:
      throw new SimGap(`function ${name}`);
  }
}

const UNIT_MS: Record<string, number> = { w: 604_800_000, d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000, ms: 1, ns: 1e-6 };

function nsCall(ns: string, name: string, args: RV[]): RV {
  if (ns === 'duration' && name === 'value') {
    const [n, u] = args;
    if (typeof n !== 'number' || typeof u !== 'string' || !(u in UNIT_MS)) fail('duration.value');
    return new RDur((n as number) * UNIT_MS[u as string]);
  }
  if (ns === 'hashing' && name === 'sha256') {
    const v = args[0];
    if (typeof v === 'string') return new RBytes(createHash('sha256').update(v, 'utf8').digest());
    if (v instanceof RBytes) return new RBytes(createHash('sha256').update(v.buf).digest());
    return fail('hashing.sha256 needs a string or bytes');
  }
  if (ns === 'timestamp' && name === 'value') return typeof args[0] === 'number' ? new RTime(args[0]) : fail('timestamp.value');
  throw new SimGap(`${ns}.${name}`);
}

function setOf(v: RV): RV[] {
  if (Array.isArray(v)) return v;
  if (v instanceof RSet) return v.items;
  return fail('expected list or set');
}

function method(o: RV, name: string, args: RV[]): RV {
  if (typeof o === 'string') {
    switch (name) {
      case 'size':
        return [...o].length;
      case 'matches': {
        const re = args[0];
        if (typeof re !== 'string') fail('matches needs a string');
        return new RegExp(`^(?:${re})$`, 'u').test(o);
      }
      case 'lower':
        return o.toLowerCase();
      case 'upper':
        return o.toUpperCase();
      case 'trim':
        return o.trim();
      case 'split':
        return typeof args[0] === 'string' ? o.split(new RegExp(args[0], 'u')) : fail('split');
      case 'replace':
        return typeof args[0] === 'string' && typeof args[1] === 'string' ? o.replace(new RegExp(args[0], 'gu'), args[1]) : fail('replace');
    }
  }
  if (Array.isArray(o) || o instanceof RSet) {
    const items = Array.isArray(o) ? o : o.items;
    switch (name) {
      case 'size':
        return Array.isArray(o) ? items.length : uniq(items).length;
      case 'hasOnly':
        return items.every((x) => contains(setOf(args[0]), x));
      case 'hasAll':
        return setOf(args[0]).every((x) => contains(items, x));
      case 'hasAny':
        return setOf(args[0]).some((x) => contains(items, x));
      case 'toSet':
        return new RSet(uniq(items));
      case 'join':
        return items.every((x) => typeof x === 'string') && typeof args[0] === 'string' ? (items as string[]).join(args[0]) : fail('join');
      case 'difference':
        return new RSet(uniq(items).filter((x) => !contains(setOf(args[0]), x)));
      case 'union':
        return new RSet(uniq([...items, ...setOf(args[0])]));
      case 'intersection':
        return new RSet(uniq(items).filter((x) => contains(setOf(args[0]), x)));
    }
  }
  if (o instanceof RMap) {
    switch (name) {
      case 'get': {
        const key = args[0];
        if (typeof key === 'string') return o.m.has(key) ? o.m.get(key)! : args[1];
        if (Array.isArray(key)) {
          let cur: RV = o;
          for (const k of key) {
            if (!(cur instanceof RMap) || typeof k !== 'string' || !cur.m.has(k)) return args[1];
            cur = cur.m.get(k)!;
          }
          return cur;
        }
        return fail('map.get key');
      }
      case 'keys':
        return [...o.m.keys()];
      case 'values':
        return [...o.m.values()];
      case 'size':
        return o.m.size;
      case 'diff':
        return args[0] instanceof RMap ? new RDiff(args[0], o) : fail('diff needs a map');
    }
  }
  if (o instanceof RDiff) {
    const before = o.a.m;
    const after = o.b.m;
    const added = [...after.keys()].filter((k) => !before.has(k));
    const removed = [...before.keys()].filter((k) => !after.has(k));
    const changed = [...after.keys()].filter((k) => before.has(k) && !eq(before.get(k)!, after.get(k)!));
    const unchanged = [...after.keys()].filter((k) => before.has(k) && eq(before.get(k)!, after.get(k)!));
    switch (name) {
      case 'addedKeys':
        return new RSet(added);
      case 'removedKeys':
        return new RSet(removed);
      case 'changedKeys':
        return new RSet(changed);
      case 'unchangedKeys':
        return new RSet(unchanged);
      case 'affectedKeys':
        return new RSet([...added, ...removed, ...changed]);
    }
  }
  if (o instanceof RTime && name === 'toMillis') return o.ms;
  // The real runtime's hex case is not documented; the rules lower-case it before comparing.
  if (o instanceof RBytes && name === 'toHexString') return o.buf.toString('hex').toUpperCase();
  if (o instanceof RBytes && name === 'toBase64') return o.buf.toString('base64');
  if (o instanceof RBytes && name === 'size') return o.buf.length;
  if (o === null) return fail(`.${name}() on null`);
  throw new SimGap(`method ${typeOf(o)}.${name}`);
}

// ------------------------------------------------------------------ matching and decisions

function matchSegs(segs: Seg[], path: string[]): { vars: Map<string, RV>; rest: string[] } | null {
  const vars = new Map<string, RV>();
  let i = 0;
  for (let s = 0; s < segs.length; s++) {
    const seg = segs[s];
    if (seg.kind === 'glob') {
      vars.set(seg.name, new RPath(path.slice(i).join('/')));
      return { vars, rest: [] };
    }
    if (i >= path.length) return null;
    if (seg.kind === 'lit' && seg.s !== path[i]) return null;
    if (seg.kind === 'cap') vars.set(seg.name, path[i]);
    i++;
  }
  return { vars, rest: path.slice(i) };
}

/** Every `allow` whose match fully consumes the path, with the scope its functions see. */
function applicable(block: MatchBlock, path: string[], parent: MatchScope | null): { allow: Allow; scope: MatchScope }[] {
  const m = matchSegs(block.segs, path);
  if (!m) return [];
  const scope: MatchScope = { fns: block.fns, vars: m.vars, parent };
  const out: { allow: Allow; scope: MatchScope }[] = [];
  if (m.rest.length === 0) for (const allow of block.allows) out.push({ allow, scope });
  for (const child of block.children) out.push(...applicable(child, m.rest, scope));
  return out;
}

const METHOD_GROUPS: Record<string, string[]> = { read: ['get', 'list'], write: ['create', 'update', 'delete'] };

export interface Decision {
  allowed: boolean;
  errors: string[];
  lookups: number;
}

export function decide(root: MatchBlock, method: string, docPath: string, ctx: EvalContext): Decision {
  const path = ['databases', '(default)', 'documents', ...docPath.split('/')];
  const errors: string[] = [];
  for (const { allow, scope } of applicable(root, path, null)) {
    const ok = allow.methods.some((m) => m === method || (METHOD_GROUPS[m] ?? []).includes(method));
    if (!ok) continue;
    if (!allow.cond) return { allowed: true, errors, lookups: ctx.lookups.size };
    try {
      if (asBool(evalNode(allow.cond, { vars: new Map(), fnScope: scope }, ctx)) === true) return { allowed: true, errors, lookups: ctx.lookups.size };
    } catch (e) {
      if (!(e instanceof RErr)) throw e;
      errors.push(e.message);
    }
  }
  return { allowed: false, errors, lookups: ctx.lookups.size };
}
