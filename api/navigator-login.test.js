import { describe, expect, it, vi } from 'vitest';
import { authenticateNavigator, NavigatorLoginError } from './navigator-login.js';
import { hashPin } from './_pin.js';

function services(member, { exists = true } = {}) {
  const set = vi.fn().mockResolvedValue();
  const ref = {
    get: vi.fn().mockResolvedValue({ exists, data: () => member }),
    set,
  };
  const createCustomToken = vi.fn().mockResolvedValue('custom-token');
  const runTransaction = vi.fn(async (callback) => callback({
    get: ref.get,
    set,
  }));
  return {
    services: {
      db: { collection: vi.fn(() => ({ doc: vi.fn(() => ref) })), runTransaction },
      auth: { createCustomToken },
    },
    set,
    runTransaction,
    createCustomToken,
  };
}

describe('authenticateNavigator', () => {
  it('creates a first PIN server-side and returns only identity data', async () => {
    const deps = services({ name: 'Ada', status: 'active' });
    const result = await authenticateNavigator({ navigatorId: 'nav-1', pin: '1234' }, deps.services);
    expect(result).toEqual({
      customToken: 'custom-token',
      navigator: { id: 'nav-1', name: 'Ada' },
      createdPin: true,
    });
    expect(deps.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pinSet: true }),
      { merge: true },
    );
    expect(deps.createCustomToken).toHaveBeenCalledWith('navigator:nav-1', {
      role: 'navigator',
      navigatorId: 'nav-1',
    });
    expect(JSON.stringify(result)).not.toContain('pinHash');
  });

  it('verifies an existing scrypt PIN and rejects a wrong PIN', async () => {
    const pinHash = await hashPin('2468', Buffer.alloc(16, 1));
    await expect(authenticateNavigator(
      { navigatorId: 'nav-1', pin: '0000' },
      services({ name: 'Ada', pinHash }).services
    )).rejects.toMatchObject({ name: 'NavigatorLoginError', status: 401 });
  });

  it('migrates a matching legacy plaintext PIN before issuing the token', async () => {
    const deps = services({ name: 'Ada', pin: '1357' });
    await authenticateNavigator({ navigatorId: 'nav-1', pin: '1357' }, deps.services);
    expect(deps.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pinSet: true }),
      { merge: true },
    );
    expect(deps.createCustomToken).toHaveBeenCalledOnce();
  });

  it('blocks inactive accounts and malformed requests', async () => {
    await expect(authenticateNavigator(
      { navigatorId: 'nav-1', pin: '1234' },
      services({ name: 'Ada', status: 'inactive' }).services
    )).rejects.toMatchObject({ status: 403 });
    await expect(authenticateNavigator(
      { navigatorId: 'nav-1', pin: '12' },
      services({ name: 'Ada' }).services
    )).rejects.toBeInstanceOf(NavigatorLoginError);
  });
});
