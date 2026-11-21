import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import auth from '../middleware/auth.js';

const TEST_SECRET = 'test-secret-for-unit-tests-only';

function mockRes() {
  const res = {};
  res.statusCode = null;
  res.body = null;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.body = obj;
    return res;
  };
  return res;
}

describe('auth middleware', () => {
  before(() => {
    process.env.JWT_SECRET = TEST_SECRET;
  });

  it('rejects a request with no token', () => {
    const req = { headers: {} };
    const res = mockRes();
    let nextCalled = false;
    auth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.msg, 'No token, authorization denied');
    assert.equal(nextCalled, false);
  });

  it('rejects a request with a malformed header', () => {
    const req = { headers: { authorization: 'Token abc123' } };
    const res = mockRes();
    let nextCalled = false;
    auth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
  });

  it('rejects an invalid token', () => {
    const req = { headers: { authorization: 'Bearer not-a-real-token' } };
    const res = mockRes();
    let nextCalled = false;
    auth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.msg, 'Token is not valid');
    assert.equal(nextCalled, false);
  });

  it('rejects a token signed with a different secret', () => {
    const token = jwt.sign(
      { id: 'user-1', email: 'a@b.com' },
      'some-other-secret',
      { expiresIn: '1h' }
    );
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    let nextCalled = false;
    auth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
  });

  it('accepts a valid token and sets req.user', () => {
    const token = jwt.sign(
      { id: 'user-1', email: 'a@b.com' },
      TEST_SECRET,
      { expiresIn: '1h' }
    );
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    let nextCalled = false;
    auth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(req.user.id, 'user-1');
    assert.equal(req.user.email, 'a@b.com');
  });
});
