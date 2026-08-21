/**
 * 페이지 공통 UI 유틸 — 토스트와 DOM 헬퍼.
 * (원본 페이지들이 쓰던 SweetAlert2 는 디자인 통일을 위해 자체 뉴모피즘 토스트/모달로 대체)
 */

/** id 로 요소를 가져온다. 없으면 즉시 실패시켜 디버깅을 쉽게 한다. */
export function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`[via] #${id} 요소를 찾을 수 없습니다.`);
  return node as T;
}

/** 선택자로 요소 목록을 가져온다. */
export function all<T extends HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export type ToastIcon = 'info' | 'success' | 'warning' | 'error';

const ICONS: Record<ToastIcon, string> = {
  info: 'bi-info-circle-fill',
  success: 'bi-check-circle-fill',
  warning: 'bi-exclamation-triangle-fill',
  error: 'bi-x-octagon-fill',
};

/** 우상단 뉴모피즘 토스트. */
export function toast(message: string, icon: ToastIcon = 'info', duration = 2000): void {
  const host = document.getElementById('via-toast-host');
  if (!host) return;

  const node = document.createElement('div');
  node.className = 'via-toast';
  node.setAttribute('role', 'status');

  const i = document.createElement('i');
  i.className = `bi ${ICONS[icon]}`;
  if (icon === 'warning') i.style.color = 'var(--via-warm-ink)';
  if (icon === 'error') i.style.color = 'var(--via-danger)';
  if (icon === 'success') i.style.color = 'var(--via-ok)';

  const span = document.createElement('span');
  span.textContent = message;

  node.append(i, span);
  host.appendChild(node);

  requestAnimationFrame(() => node.classList.add('is-in'));
  window.setTimeout(() => {
    node.classList.remove('is-in');
    window.setTimeout(() => node.remove(), 250);
  }, duration);
}

/** 값을 [min, max] 로 자른다. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
