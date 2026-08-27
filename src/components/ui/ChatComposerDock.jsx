'use client';

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';

/**
 * The floating shelf the chat composer sits on. It measures itself and hands
 * the message list exactly the bottom padding needed to clear it, so the last
 * message is never hidden behind the input at any composer height.
 *
 * @param {React.ElementType} props.as Element or component to render as; `form` where the composer submits.
 * @param {React.RefObject} props.scrollRef The scroller to pad. Without it only the CSS variable is published.
 * @param {string} props.composition Named size contract for a specific place, resolved in globals.css.
 * @param {React.ReactNode} props.children The composer.
 * @param {string} props.className Placement in the parent only.
 */
const ChatComposerDock = forwardRef(function ChatComposerDock({
  as: Component = 'div',
  scrollRef = null,
  composition,
  className = '',
  children,
  ...props
}, forwardedRef) {
  const dockRef = useRef(null);
  useImperativeHandle(forwardedRef, () => dockRef.current, []);

  useLayoutEffect(() => {
    const dock = dockRef.current;
    const scroll = scrollRef?.current;
    if (!dock) return undefined;

    const updateOverlap = () => {
      const overlap = Math.max(1, Math.round(dock.getBoundingClientRect().height / 2));
      dock.style.setProperty('--chat-composer-overlap', `${overlap}px`);
      if (scroll) {
        scroll.style.paddingBottom = `${overlap + 16}px`;
      }
    };

    updateOverlap();
    if (typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(updateOverlap);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      scroll?.style.removeProperty('padding-bottom');
    };
  }, [scrollRef]);

  return (
    <Component ref={dockRef} data-ui-composition={composition} className={`chat-composer-dock ${className}`} {...props}>
      {children}
    </Component>
  );
});

export default ChatComposerDock;
