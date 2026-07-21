import { afterEach, describe, expect, it } from 'vitest';
import { coerceViewport, readViewportCookie, viewportCookieName } from '../src/web/viewport';

describe('web viewport persistence', () => {
  afterEach(() => {
    document.cookie = `${viewportCookieName('cookie_canvas')}=; Max-Age=0; Path=/`;
  });

  it('marks a viewport restored from a browser cookie as user-owned', () => {
    const value = encodeURIComponent(JSON.stringify({ centerX: 320, centerY: -45, zoom: 1.25 }));
    document.cookie = `${viewportCookieName('cookie_canvas')}=${value}; Path=/`;

    expect(coerceViewport(readViewportCookie('cookie_canvas'))).toMatchObject({
      centerX: 320,
      centerY: -45,
      zoom: 1.25,
      source: 'user'
    });
  });
});
