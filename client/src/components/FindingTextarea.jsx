import React, { useLayoutEffect, useRef } from 'react';

export default function FindingTextarea({ value, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => {
      const previous = element.getBoundingClientRect().height;
      element.style.height = 'auto';
      element.style.height = `${Math.max(previous, 160, Math.min(element.scrollHeight + 2, window.innerHeight * 0.5))}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [value]);
  return <textarea {...props} ref={ref} value={value} rows={7} style={{ minHeight: 160, maxHeight: '65vh', resize: 'vertical', overflowY: 'auto' }} />;
}
