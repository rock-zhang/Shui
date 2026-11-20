"use client";

import { useEffect, useRef } from "react";
import { usePlatform } from "./use-platform";

/**
 * Android 系统返回键的浮层拦截。
 *
 * 原生侧（wry 的 WryActivity）对返回键的处理是：WebView 有历史记录就
 * goBack()（前端表现为 popstate），没有就直接结束 Activity 回桌面。
 * 本项目是 SPA，历史栈平时为空，所以弹窗开着时按返回键会直接退到桌面。
 *
 * 解法是「哨兵条目」：第一个浮层打开时向历史栈压入一条同文档的
 * pushState 记录，让返回键变成 WebView 内的后退；全局 popstate 监听
 * 收到后关闭栈顶浮层。最后一个浮层关闭时再用 history.back() 把哨兵
 * 消费掉，恢复「无历史可退 → 返回键退 App」的原有行为。
 *
 * 多层弹窗共享同一个哨兵：popstate 关掉栈顶后若还有浮层，立即重压
 * 一条；各浮层通过 effect cleanup 注销，配合 stack 去重保证不会重复。
 *
 * 只在 Android 注册（桌面/iOS 没有系统返回键，压哨兵只会污染历史栈）。
 */

type CloseFn = () => void;

/** 打开着的浮层的关闭函数，后进先出——返回键永远关最上面的那个。 */
const stack: CloseFn[] = [];
/** 历史栈顶是否压着哨兵条目。 */
let armed = false;

function arm() {
  if (armed) return;
  armed = true;
  history.pushState({ __shuiBackGuard: true }, "");
}

function disarm() {
  if (!armed) return;
  armed = false;
  // 消费哨兵条目；由此触发的 popstate 里 armed 已为 false，不会误关浮层。
  history.back();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (!armed) return; // 页面自身的前进/后退，与哨兵无关
    armed = false;
    const top = stack[stack.length - 1];
    if (top) top(); // 走组件自己的关闭流程，effect cleanup 会负责注销
    if (stack.length > 0) arm(); // 顶层下面还有浮层，哨兵不能断
  });
}

function registerBackClose(close: CloseFn): () => void {
  stack.push(close);
  arm();
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    const idx = stack.indexOf(close);
    // idx 为 -1 说明刚被 popstate 路径关掉（栈里已经弹掉了），直接返回；
    // 此时的哨兵要么已被 popstate 消费，要么为更深的浮层保留。
    if (idx === -1) return;
    stack.splice(idx, 1);
    if (stack.length === 0) disarm();
  };
}

/**
 * 浮层打开期间，Android 返回键改为触发 close 而不是退出 App。
 * 用法：useBackToClose(detailsOpen, () => setDetailsOpen(false))。
 */
export function useBackToClose(open: boolean, close: CloseFn) {
  const { isAndroid } = usePlatform();
  // close 常是内联箭头函数，存 ref 保证它变化时不会反复注销/注册
  //（那会让哨兵在历史栈里来回弹压）。
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    if (!isAndroid || !open) return;
    return registerBackClose(() => closeRef.current());
  }, [isAndroid, open]);
}
