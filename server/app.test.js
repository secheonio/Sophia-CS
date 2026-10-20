import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createApp } from './app.js'
import { openDatabase } from './db.js'
import { generateTemporaryPassword, hashPassword } from './security.js'

// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
const PASSWORD = 'Sophia-test-1234'

let server
let base
let db

class Client {
  cookie = ''
  async call(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) this.cookie = setCookie.split(';')[0]
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* 이미지 등 */ }
    return { status: res.status, json, res }
  }
  get = (url) => this.call('GET', url)
  post = (url, body) => this.call('POST', url, body)
  patch = (url, body) => this.call('PATCH', url, body)
}

async function addUser(name, email, department, position) {
  const hash = await hashPassword(PASSWORD)
  db.prepare(
    `INSERT INTO users (email, name, department, position, password_hash, must_change_password, active, created_at)
     VALUES (?, ?, ?, ?, ?, 0, 1, '2026-10-20')`,
  ).run(email, name, department, position, hash)
}

async function login(email, password = PASSWORD) {
  const client = new Client()
  const result = await client.post('/api/auth/login', { email, password })
  assert.equal(result.status, 200, JSON.stringify(result.json))
  return client
}

const draft = (extra = {}) => ({ title: '교구 구입', category: '비품·소모품', amount: 50000, memo: '실습 교구', ...extra })

before(async () => {
  db = openDatabase(':memory:')
  await addUser('이교장', 'principal@test.kr', '교장', '교장')
  await addUser('박행정', 'admin@test.kr', '행정실', '행정실장')
  await addUser('김기초', 'head1@test.kr', '기초과정', '기관장')
  await addUser('최교무', 'head2@test.kr', '교무부', '기관장')
  await addUser('한기안', 'staff1@test.kr', '기초과정', '기안자')
  await addUser('윤교무', 'staff2@test.kr', '교무부', '기안자')
  await addUser('오본과', 'staff3@test.kr', '본과정', '기안자')
  const app = createApp(db)
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  server.closeAllConnections()
  server.close()
})

describe('인증', () => {
  test('로그인 없이는 API를 쓸 수 없다', async () => {
    const anonymous = new Client()
    assert.equal((await anonymous.get('/api/requests')).status, 401)
    assert.equal((await anonymous.get('/api/attachments/1')).status, 401)
  })

  test('잘못된 비밀번호와 없는 계정은 같은 오류로 거부한다', async () => {
    const wrongPassword = await new Client().post('/api/auth/login', { email: 'staff1@test.kr', password: 'wrong-password' })
    const unknown = await new Client().post('/api/auth/login', { email: 'nobody@test.kr', password: 'wrong-password' })
    assert.equal(wrongPassword.status, 401)
    assert.equal(unknown.status, 401)
    assert.equal(wrongPassword.json.error, unknown.json.error)
  })

  test('비밀번호 해시는 응답에 노출되지 않는다', async () => {
    const client = await login('staff1@test.kr')
    const me = await client.get('/api/me')
    assert.equal(me.json.user.email, 'staff1@test.kr')
    assert.equal(JSON.stringify(me.json).includes('hash'), false)
  })

  test('반복 실패하면 정상 비밀번호도 일시 차단한다', async () => {
    const client = new Client()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await client.post('/api/auth/login', { email: 'staff3@test.kr', password: 'bad-password' })).status, 401)
    }
    assert.equal((await client.post('/api/auth/login', { email: 'staff3@test.kr', password: PASSWORD })).status, 429)
  })

  test('JSON이 아니거나 다른 출처의 변경 요청은 거부한다', async () => {
    const client = await login('staff1@test.kr')
    const plain = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: client.cookie, 'Content-Type': 'text/plain' }, body: 'x' })
    assert.equal(plain.status, 415)
    const foreign = await client.call('POST', '/api/requests', draft(), { Origin: 'https://evil.example' })
    assert.equal(foreign.status, 403)
  })

  test('임시 비밀번호는 변경하기 전에는 다른 기능을 쓸 수 없다', async () => {
    const temporary = generateTemporaryPassword()
    db.prepare(
      `INSERT INTO users (email, name, department, position, password_hash, must_change_password, active, created_at)
       VALUES ('new@test.kr', '신입', '생활관', '기안자', ?, 1, 1, '2026-10-20')`,
    ).run(await hashPassword(temporary))
    const client = await login('new@test.kr', temporary)
    const blocked = await client.get('/api/requests')
    assert.equal(blocked.status, 403)
    assert.equal(blocked.json.code, 'PASSWORD_CHANGE_REQUIRED')
    assert.equal((await client.post('/api/auth/change-password', { currentPassword: temporary, newPassword: '1234' })).status, 400)
    assert.equal((await client.post('/api/auth/change-password', { currentPassword: temporary, newPassword: 'Changed-pass-99' })).status, 200)
    assert.equal((await client.get('/api/me')).json.user.mustChangePassword, false)
    assert.equal((await client.get('/api/meta')).status, 200)
  })
})

describe('결재 흐름', () => {
  test('기안 → 기관장 → 교장 → 행정실장 순서로만 진행되고 지출 완료가 된다', async () => {
    const staff = await login('staff1@test.kr')
    const created = await staff.post('/api/requests', draft({ newAttachments: [{ name: '영수증.png', dataUrl: PNG }] }))
    assert.equal(created.status, 201)
    const request = created.json.request
    assert.deepEqual(request.steps.map((step) => `${step.name}:${step.kind}:${step.status}`), [
      '김기초:확인 결재:결재 중', '이교장:최종 결재:대기', '박행정:지출 처리:대기',
    ])
    assert.equal(request.attachments.length, 1)

    const head = await login('head1@test.kr')
    const principal = await login('principal@test.kr')
    const accountant = await login('admin@test.kr')
    const url = `/api/requests/${request.id}/decision`

    assert.equal((await principal.post(url, { action: 'approve' })).status, 403)
    assert.equal((await accountant.post(url, { action: 'approve' })).status, 403)
    assert.equal((await staff.post(url, { action: 'approve' })).status, 403)

    assert.equal((await head.post(url, { action: 'approve' })).json.request.status, '결재 중')
    assert.equal((await head.post(url, { action: 'approve' })).status, 403)
    assert.equal((await accountant.post(url, { action: 'approve' })).status, 403)
    assert.equal((await principal.post(url, { action: 'approve' })).json.request.status, '지출 대기')
    assert.equal((await accountant.post(url, { action: 'approve' })).json.request.status, '지출 완료')
    assert.equal((await accountant.post(url, { action: 'approve' })).status, 403)
  })

  test('행정실장은 기관장 확인 없이 교장에게 바로 상신한다', async () => {
    const accountant = await login('admin@test.kr')
    const { request } = (await accountant.post('/api/requests', draft())).json
    assert.deepEqual(request.steps.map((step) => `${step.name}:${step.kind}`), ['이교장:최종 결재', '박행정:지출 처리'])
  })

  test('반려는 사유가 필수이고 재상신하면 결재선이 처음부터 다시 시작된다', async () => {
    const staff = await login('staff2@test.kr')
    const head = await login('head2@test.kr')
    const { request } = (await staff.post('/api/requests', draft({ newAttachments: [{ name: 'a.png', dataUrl: PNG }] }))).json
    const url = `/api/requests/${request.id}/decision`

    assert.equal((await head.post(url, { action: 'reject' })).status, 400)
    assert.equal((await head.post(url, { action: 'reject', reason: '   ' })).status, 400)
    const rejected = (await head.post(url, { action: 'reject', reason: '금액 불일치' })).json.request
    assert.equal(rejected.status, '반려')
    assert.equal(rejected.rejection.reason, '금액 불일치')

    const other = await login('staff1@test.kr')
    assert.equal((await other.post(`/api/requests/${request.id}/resubmit`, draft())).status, 404)
    assert.equal((await head.post(`/api/requests/${request.id}/resubmit`, draft())).status, 403)

    const resubmitted = (await staff.post(`/api/requests/${request.id}/resubmit`, draft({
      amount: 40000, keepAttachmentIds: [], newAttachments: [{ name: 'b.png', dataUrl: PNG }],
    }))).json.request
    assert.equal(resubmitted.status, '결재 중')
    assert.equal(resubmitted.rejection, null)
    assert.equal(resubmitted.amount, 40000)
    assert.equal(resubmitted.steps[0].status, '결재 중')
    assert.equal(resubmitted.attachments.length, 1)
    assert.notEqual(resubmitted.attachments[0].id, request.attachments[0].id)
    assert.equal((await staff.post(`/api/requests/${request.id}/resubmit`, draft())).status, 409)
  })

  test('기관장이 지정되지 않은 부서의 기안은 거부한다', async () => {
    const staff = await login('staff3@test.kr', PASSWORD).catch(() => null)
    const user = staff ?? new Client()
    // 앞선 테스트의 로그인 차단과 무관하게 세션을 직접 만든다.
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run((await import('./security.js')).sha256('manual-token'), db.prepare("SELECT id FROM users WHERE email = 'staff3@test.kr'").get().id, Date.now() + 60000)
    user.cookie = 'sid=manual-token'
    const result = await user.post('/api/requests', draft())
    assert.equal(result.status, 409)
    assert.match(result.json.error, /기관장/)
  })

  test('입력값을 서버에서 검증한다', async () => {
    const staff = await login('staff1@test.kr')
    for (const bad of [
      draft({ amount: 0 }), draft({ amount: 1.5 }), draft({ amount: '5000' }), draft({ amount: 2_000_000_000 }),
      draft({ title: '   ' }), draft({ title: 'x'.repeat(81) }), draft({ category: '없는항목' }), draft({ memo: 'x'.repeat(501) }),
    ]) {
      assert.equal((await staff.post('/api/requests', bad)).status, 400, JSON.stringify(bad).slice(0, 80))
    }
  })
})

describe('열람 제한과 첨부', () => {
  test('본인이 기안했거나 결재선에 포함된 품의만 볼 수 있다', async () => {
    const staff = await login('staff1@test.kr')
    const { request } = (await staff.post('/api/requests', draft({ title: '열람 제한 확인', newAttachments: [{ name: 'r.png', dataUrl: PNG }] }))).json
    const titles = async (client) => (await client.get('/api/requests')).json.requests.map((item) => item.title)

    assert.ok((await titles(staff)).includes('열람 제한 확인'))
    assert.ok((await titles(await login('head1@test.kr'))).includes('열람 제한 확인'))
    assert.ok((await titles(await login('principal@test.kr'))).includes('열람 제한 확인'))
    assert.ok((await titles(await login('admin@test.kr'))).includes('열람 제한 확인'))
    assert.equal((await titles(await login('head2@test.kr'))).includes('열람 제한 확인'), false)
    assert.equal((await titles(await login('staff2@test.kr'))).includes('열람 제한 확인'), false)

    const attachmentUrl = `/api/attachments/${request.attachments[0].id}`
    const own = await staff.get(attachmentUrl)
    assert.equal(own.status, 200)
    assert.equal(own.res.headers.get('content-type'), 'image/png')
    assert.equal(own.res.headers.get('x-content-type-options'), 'nosniff')
    assert.equal((await (await login('head2@test.kr')).get(attachmentUrl)).status, 404)
    assert.equal((await (await login('head1@test.kr')).get(attachmentUrl)).status, 200)
  })

  test('이미지가 아니거나 위장된 파일, 개수·크기 초과는 거부한다', async () => {
    const staff = await login('staff1@test.kr')
    const attempt = (newAttachments) => staff.post('/api/requests', draft({ newAttachments }))
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`
    const fakePng = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`
    const big = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(5 * 1024 * 1024)]).toString('base64')}`
    assert.equal((await attempt([{ name: 'x.svg', dataUrl: svg }])).status, 400)
    assert.equal((await attempt([{ name: 'x.png', dataUrl: fakePng }])).status, 400)
    assert.equal((await attempt([{ name: 'big.png', dataUrl: big }])).status, 400)
    assert.equal((await attempt(Array.from({ length: 6 }, (_, index) => ({ name: `${index}.png`, dataUrl: PNG })))).status, 400)
    assert.equal((await attempt('not-a-list')).status, 400)
  })
})

const transferTests = () => describe('교장 교체', () => {
  test('교장만 교체할 수 있고 확인이 필요하다', async () => {
    const head = await login('head1@test.kr')
    assert.equal((await head.post('/api/principal/transfer', { name: 'x', email: 'x@test.kr', confirm: true })).status, 403)
    const principal = await login('principal@test.kr')
    assert.equal((await principal.post('/api/principal/transfer', { name: 'x', email: 'x@test.kr' })).status, 400)
    assert.equal((await principal.post('/api/principal/transfer', { userId: 2, confirm: true })).status, 400)
  })

  test('새 교장 생성: 진행 중 결재가 넘어가고 과거 품의를 모두 볼 수 있다', async () => {
    const staff = await login('staff1@test.kr')
    const principal = await login('principal@test.kr')
    const accountant = await login('admin@test.kr')
    const head2 = await login('head1@test.kr')
    const waiting = (await staff.post('/api/requests', draft({ title: '교체 시 교장 차례' }))).json.request
    const done = (await staff.post('/api/requests', draft({ title: '교체 전 완료' }))).json.request
    await head2.post(`/api/requests/${waiting.id}/decision`, { action: 'approve' })
    await head2.post(`/api/requests/${done.id}/decision`, { action: 'approve' })
    await principal.post(`/api/requests/${done.id}/decision`, { action: 'approve' })
    await accountant.post(`/api/requests/${done.id}/decision`, { action: 'approve' })

    const result = await principal.post('/api/principal/transfer', { name: '새교장', email: 'New.Principal@test.kr', confirm: true })
    assert.equal(result.status, 200, JSON.stringify(result.json))
    assert.ok(result.json.temporaryPassword)
    assert.ok(result.json.transferredSteps >= 1)

    assert.equal((await principal.get('/api/me')).status, 401)
    assert.equal((await new Client().post('/api/auth/login', { email: 'principal@test.kr', password: PASSWORD })).status, 401)

    const next = await login('new.principal@test.kr', result.json.temporaryPassword)
    assert.equal((await next.get('/api/requests')).status, 403)
    assert.equal((await next.post('/api/auth/change-password', { currentPassword: result.json.temporaryPassword, newPassword: 'New-principal-77' })).status, 200)

    const list = (await next.get('/api/requests')).json.requests
    assert.ok(list.some((item) => item.title === '교체 전 완료'))
    const moved = list.find((item) => item.id === waiting.id)
    assert.equal(moved.steps[1].name, '새교장')
    assert.equal((await next.post(`/api/requests/${waiting.id}/decision`, { action: 'approve' })).json.request.status, '지출 대기')
    const finished = list.find((item) => item.id === done.id)
    assert.equal(finished.steps[1].name, '이교장')
    assert.equal((await next.get('/api/users')).status, 200)
  })

  test('기존 사용자를 교장으로 지정할 수 있고, 결재 중인 사용자와 행정실장은 막는다', async () => {
    await addUser('후보', 'cand@test.kr', '생활관', '기안자')
    const principal = await login('new.principal@test.kr', 'New-principal-77')
    const users = (await principal.get('/api/users')).json.users
    const idOf = (email) => users.find((user) => user.email === email).id
    assert.equal((await principal.post('/api/principal/transfer', { userId: idOf('admin@test.kr'), confirm: true })).status, 400)
    await (await login('staff1@test.kr')).post('/api/requests', draft({ title: '기관장 결재 대기' }))
    assert.equal((await principal.post('/api/principal/transfer', { userId: idOf('head1@test.kr'), confirm: true })).status, 409)
    const ok = await principal.post('/api/principal/transfer', { userId: idOf('cand@test.kr'), confirm: true })
    assert.equal(ok.status, 200, JSON.stringify(ok.json))
    assert.equal(ok.json.user.position, '교장')
    assert.equal(ok.json.temporaryPassword, null)
  })
})

describe('사용자 관리', () => {
  test('교장만 사용자를 관리할 수 있다', async () => {
    for (const email of ['head1@test.kr', 'admin@test.kr', 'staff1@test.kr']) {
      const client = await login(email)
      assert.equal((await client.get('/api/users')).status, 403)
      assert.equal((await client.post('/api/users', { name: 'a', email: 'a@test.kr', department: '생활관', position: '기안자' })).status, 403)
    }
  })

  test('사용자를 추가하면 임시 비밀번호가 한 번 발급되고 첫 로그인 때 변경해야 한다', async () => {
    const principal = await login('principal@test.kr')
    const created = await principal.post('/api/users', { name: '신규', email: 'Fresh@Test.kr', department: '델포이', position: '기안자' })
    assert.equal(created.status, 201)
    assert.equal(created.json.user.email, 'fresh@test.kr')
    assert.equal(created.json.user.mustChangePassword, true)
    assert.ok(created.json.temporaryPassword.length >= 12)

    const fresh = await login('fresh@test.kr', created.json.temporaryPassword)
    assert.equal((await fresh.get('/api/requests')).status, 403)

    const duplicate = await principal.post('/api/users', { name: '중복', email: 'fresh@test.kr', department: '델포이', position: '기안자' })
    assert.equal(duplicate.status, 409)
  })

  test('직책 규칙을 지킨다: 교장·행정실장 1명, 부서당 기관장 1명, 행정실은 행정실장만', async () => {
    const principal = await login('principal@test.kr')
    const add = (department, position, email) => principal.post('/api/users', { name: '시험', email, department, position })
    assert.equal((await add('교장', '교장', 'p2@test.kr')).status, 409)
    assert.equal((await add('행정실', '행정실장', 'a2@test.kr')).status, 409)
    assert.equal((await add('기초과정', '기관장', 'h2@test.kr')).status, 409)
    assert.equal((await add('행정실', '기안자', 'a3@test.kr')).status, 400)
    assert.equal((await add('기초과정', '교장', 'p3@test.kr')).status, 400)
    assert.equal((await add('없는부서', '기안자', 'x@test.kr')).status, 400)
    assert.equal((await add('심화과정', '기관장', 'h3@test.kr')).status, 201)
  })

  test('본인 직책 변경과 결재 중인 담당자의 변경은 막고, 비활성 계정은 로그인할 수 없다', async () => {
    const principal = await login('principal@test.kr')
    const users = (await principal.get('/api/users')).json.users
    const idOf = (email) => users.find((user) => user.email === email).id
    assert.equal((await principal.patch(`/api/users/${idOf('principal@test.kr')}`, { active: false })).status, 400)

    const staff = await login('staff1@test.kr')
    await staff.post('/api/requests', draft({ title: '결재 중 변경 방지' }))
    assert.equal((await principal.patch(`/api/users/${idOf('head1@test.kr')}`, { active: false })).status, 409)

    const target = idOf('staff3@test.kr')
    assert.equal((await principal.patch(`/api/users/${target}`, { active: false })).status, 200)
    db.prepare('DELETE FROM sessions').run()
    limiterFreeLogin: {
      const attempt = await new Client().post('/api/auth/login', { email: 'staff3@test.kr', password: PASSWORD })
      assert.notEqual(attempt.status, 200)
    }
  })

  test('비밀번호를 초기화하면 기존 세션이 끊기고 새 임시 비밀번호가 필요하다', async () => {
    const principal = await login('principal@test.kr')
    const staff = await login('staff2@test.kr')
    const id = (await principal.get('/api/users')).json.users.find((user) => user.email === 'staff2@test.kr').id
    const reset = await principal.post(`/api/users/${id}/reset-password`)
    assert.equal(reset.status, 200)
    assert.equal((await staff.get('/api/me')).status, 401)
    assert.equal((await new Client().post('/api/auth/login', { email: 'staff2@test.kr', password: PASSWORD })).status, 401)
    const again = await login('staff2@test.kr', reset.json.temporaryPassword)
    assert.equal((await again.get('/api/me')).json.user.mustChangePassword, true)
  })
})

transferTests()
