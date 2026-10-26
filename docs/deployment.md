# 학교 Ubuntu 서버 설치·배포 안내서

이 문서는 “학교 컴퓨터에서 윈도우를 제거하고 Ubuntu만 설치한 상태”에서 시작하는 작업 절차입니다.

현재 기준 아키텍처는 다음과 같습니다.

- 개발: 집/노트북에서 VS Code로 코드 수정
- 저장: GitHub에 업로드
- 실행 서버: 학교 내부 LAN에 연결된 Ubuntu 서버
- 외부 공개: Cloudflare Tunnel + Cloudflare 도메인
- 운영 주소 예시: `https://expense.example.com`

학교 네트워크는 보통 다음처럼 보입니다.

- Ubuntu 서버: 같은 LAN 안에 연결 (`192.168.1.x` 대역)
- 게이트웨이: `192.168.1.254`
- 인터넷: 외부 통신 가능 (`ping 8.8.8.8`, `curl https://example.com` 확인됨)
- 공개 IP 직접 포트포워딩 불필요: Cloudflare Tunnel 사용

아래 순서대로 진행하면 됩니다.

## 0. 학교 방문 전 체크리스트

- Ubuntu 설치 USB 준비
- 학교 LAN에 연결할 수 있는 케이블 또는 Wi‑Fi 확인
- 서버를 연결할 위치를 정함: 메인 스위치 또는 라우터의 LAN 포트
- Cloudflare에 도메인 등록 완료
- GitHub 저장소에 코드가 push된 상태
- 학교에서 SSH 접속용 계정/비밀번호 준비

## 1. Ubuntu 설치

1. Ubuntu 22.04 LTS 이상 ISO를 준비합니다.
2. USB 부팅으로 설치합니다.
3. 언어/키보드/시간대를 선택합니다.
4. 사용자 이름을 정합니다. 권장:
   - 사용자 이름: `sophia`
   - 컴퓨터 이름: `sophia-school-server`
5. 설치가 끝나면 재시작합니다.
6. 처음 로그인 후, 터미널을 엽니다.

## 2. Ubuntu 네트워크 확인

학교 LAN의 IP는 보통 `192.168.1.x` 대역이며, 게이트웨이는 `192.168.1.254`입니다.

아래 명령으로 현재 상태를 확인합니다.

```bash
ip a
ip route
cat /etc/netplan/*.yaml
```

정상적으로 보이면 대략 다음과 같습니다.

```bash
# 예시
inet 192.168.1.50/24
default via 192.168.1.254
```

인터넷이 되는지 확인합니다.

```bash
ping -c 4 8.8.8.8
curl -I https://example.com
```

정상이라면 다음 단계로 진행합니다.

### 2-1. 학교 LAN에 맞는 네트워크 설정 예시

`/etc/netplan/50-cloud-init.yaml` 또는 비슷한 파일을 수정합니다.

```bash
sudo nano /etc/netplan/01-netcfg.yaml
```

예시:

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    eth0:
      dhcp4: false
      addresses:
        - 192.168.1.50/24
      routes:
        - to: default
          via: 192.168.1.254
      nameservers:
        addresses: [8.8.8.8, 1.1.1.1]
```

적용:

```bash
sudo netplan generate
sudo netplan apply
ip a
ip route
```

필요하면 학교 네트워크 담당자가 제공한 DNS/IP 대역을 반영해 주세요.

> 참고: 학교에 보안 정책상 DHCP가 막혀 있으면 고정 IP를 직접 지정하는 방식이 가장 안전합니다.

## 3. Ubuntu 기본 보안 설정

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw ca-certificates gnupg
sudo usermod -aG sudo sophia
```

필수 방화벽 규칙:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw enable
sudo ufw status
```

> 22번 포트는 내부망/관리용으로만 허용하세요. 공공 인터넷으로 직접 SSH를 열지 마세요.

## 4. Node.js 설치

Node.js 24 권장입니다.

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 5. 프로젝트 내려받기

```bash
cd /opt
sudo git clone https://github.com/secheonio/Sophia-CS.git sophia-cs
sudo chown -R sophia:sophia /opt/sophia-cs
cd /opt/sophia-cs
npm ci
npm run build
```

정상이라면 빌드가 끝나고 `dist` 또는 결과물이 생성됩니다.

## 6. 앱 실행 준비

프로젝트 폴더를 확인하고 서버 실행 포트를 점검합니다. 현재 앱은 보통 `3001` 포트를 사용합니다.

```bash
cat package.json
```

실행 명령 확인:

```bash
npm run start -- --help
```

필요한 경우 서버 포트와 환경변수를 확인합니다.

## 7. systemd 서비스 등록

`/etc/systemd/system/sophia-cs.service` 파일을 만듭니다.

```bash
sudo nano /etc/systemd/system/sophia-cs.service
```

예시:

```ini
[Unit]
Description=Sophia CS app
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/sophia-cs
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
Environment=NODE_ENV=production
User=sophia
Group=sophia

[Install]
WantedBy=multi-user.target
```

적용:

```bash
sudo systemctl daemon-reload
sudo systemctl enable sophia-cs
sudo systemctl start sophia-cs
sudo systemctl status sophia-cs --no-pager
```

서비스가 정상 상태인지 확인합니다.

```bash
curl -I http://127.0.0.1:3001
```

이 응답이 오면 앱이 실행 중입니다.

## 8. Cloudflare 설정 준비

학교에서 포트 80/443을 직접 여는 대신 Cloudflare Tunnel 방식을 사용합니다.

필수 준비물:

- Cloudflare 계정
- 도메인 소유권 확인 완료
- `expense.example.com` 같은 서브도메인 확인

1. Ubuntu 서버에 `cloudflared` 설치

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared --version
```

2. 로그인

```bash
cloudflared tunnel login
```

브라우저가 열리면 Cloudflare 계정으로 로그인합니다. 인증서가 생성됩니다.

3. 터널 생성

```bash
cloudflared tunnel create sophia-school
```

결과로 다음과 같은 값이 나옵니다.

- tunnel ID
- credentials 파일 경로

4. 설정 파일 작성

```bash
mkdir -p ~/.cloudflared
nano ~/.cloudflared/config.yml
```

예시:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /home/sophia/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: expense.example.com
    service: http://localhost:3001
  - service: http_status:404
```

5. DNS 등록

```bash
cloudflared tunnel route dns sophia-school expense.example.com
```

6. 터널 실행

```bash
cloudflared tunnel run sophia-school
```

터널이 정상 동작하면, 브라우저에서 다음 주소로 접속할 수 있습니다.

```text
https://expense.example.com
```

## 9. Cloudflare 터널을 자동 실행으로 설정

`systemd` 서비스로 등록합니다.

```bash
sudo nano /etc/systemd/system/cloudflared.service
```

예시:

```ini
[Unit]
Description=Cloudflare Tunnel
After=network.target

[Service]
Type=simple
User=sophia
ExecStart=/usr/local/bin/cloudflared tunnel run sophia-school
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

적용:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared --no-pager
```

## 10. 첫 관리자 계정 만들기

프로젝트에 기본 관리자 생성 스크립트가 있다면 아래처럼 실행합니다.

```bash
cd /opt/sophia-cs
DATABASE_FILE=/var/lib/sophia-cs/app.db npm run create-admin -- "교장" principal@school.example
```

비밀번호를 입력하거나 임시 비밀번호를 사용합니다.

브라우저에서 확인:

```text
https://expense.example.com
```

로그인 후 사용자/직책 화면에서 나머지 사용자를 추가합니다.

## 11. 백업 설정

### 11-1. 서버 백업

```bash
sudo mkdir -p /var/backups/sophia-cs
sudo chown -R sophia:sophia /var/backups/sophia-cs
```

매일 3시 자동 백업 스크립트 예시:

```bash
sudo crontab -e
```

추가:

```cron
0 3 * * * /opt/sophia-cs/deploy/backup.sh
```

### 11-2. Windows PC로 백업 받기

클라우드 또는 학교 PC에서 별도 백업 스크립트를 돌릴 수 있습니다. 시작하기 전에 서버의 SSH 접속과 공개키 설정을 확인합니다.

## 12. 학교에서 바로 점검할 체크리스트

학교에 가서 아래 순서대로 확인하면 됩니다.

- [ ] Ubuntu 서버 전원 연결, 부팅 완료
- [ ] 학교 LAN에 정상 연결됨
- [ ] `ip a` 결과 확인
- [ ] `ip route`에서 게이트웨이 확인
- [ ] `ping 8.8.8.8` 성공
- [ ] `curl https://example.com` 성공
- [ ] `sudo apt update` 성공
- [ ] `node -v` / `npm -v` 성공
- [ ] GitHub 저장소가 클론됨
- [ ] `npm ci` 성공
- [ ] `npm run build` 성공
- [ ] `systemctl status sophia-cs`에서 running 확인
- [ ] `curl http://127.0.0.1:3001` 성공
- [ ] Cloudflare Tunnel 연결 확인
- [ ] `https://expense.example.com` 접속 확인
- [ ] 첫 교장 계정 로그인 성공
- [ ] 관리자 화면에서 사용자 추가 가능 확인

## 13. 가장 자주 발생하는 문제

### 13-1. 네트워크 불가

```bash
ip a
ip route
cat /etc/resolv.conf
ping 8.8.8.8
```

- 학교 LAN 설정이 잘못되었는지 확인
- 게이트웨이와 서브넷이 올바른지 확인
- DHCP 또는 고정 IP가 제대로 주어졌는지 확인

### 13-2. 인터넷은 되는데 앱 접속이 안 됨

```bash
sudo systemctl status sophia-cs --no-pager
journalctl -u sophia-cs -n 50 --no-pager
```

- 포트 3001이 열려 있는지 확인
- `.env` 또는 환경변수 설정 누락 여부 확인
- 앱 로그 확인

### 13-3. Cloudflare 연결이 안 됨

```bash
cloudflared tunnel run sophia-school
journalctl -u cloudflared -n 50 --no-pager
```

- 도메인 DNS 기록이 올바른지 확인
- tunnel ID와 credentials 파일이 맞는지 확인
- 로그를 보고 에러 메시지 확인

## 14. 다음 작업

다음 단계는 다음과 같습니다.

1. 첫 교장 계정 생성
2. 사용자/부서/직책 등록
3. 실제 결재자 흐름 테스트
4. 이미지 첨부 테스트
5. 반려 사유 필수 입력 테스트
6. 백업 복구 연습
7. 실제 운영 전 최종 검증

## 15. 마지막으로

이 문서는 학교에 직접 가서 따라 하기 위한 운영용 체크리스트입니다.

- 네트워크 연결 상태 확인
- Ubuntu 설치
- 앱 배포
- Cloudflare 리버스 프록시 연결
- 첫 관리자 생성
- 실제 페이지 접속 확인

이 순서만 지켜도 학교 서버 운영은 시작할 수 있습니다.

필요하면 이 문서를 기준으로 실제 서버용 `README` 또는 `운영 절차서`를 별도 파일로 정리해 둡니다.

```
사용자 브라우저 ──HTTPS──> 학교 공유기(고정 IP 1.217.30.146) ──80/443──> Ubuntu 서버
                                                                      ├ Caddy (HTTPS 인증서 자동 발급·갱신)
                                                                      └ Node 앱 (127.0.0.1:3001, 자동 시작)
Windows 학교 PC ──(매일, 내부망)──> Ubuntu 서버의 백업 폴더를 내려받음
```

## 한눈에 보기: 선생님이 하실 일

| 순서 | 작업 | 어디서 | 소요 |
|---|---|---|---|
| 1 | 가비아 DNS에 `expense` 주소 등록 | 가비아 사이트 | 5분 |
| 2 | Ubuntu 서버에 고정 내부 IP 지정 | 공유기 / 서버 | 10분 |
| 3 | 서버에 프로그램 설치·실행 | Ubuntu 서버 | 30분 |
| 4 | 공유기에서 포트 80·443 연결 | 공유기 관리 화면 | 10분 |
| 5 | 첫 교장 계정 만들기 | Ubuntu 서버 | 2분 |
| 6 | 백업 내려받기 설정 | Windows 학교 PC | 15분 |

2~3번을 먼저 하고, **4번(포트 연결)은 서버가 내부에서 정상 동작하는 것을 확인한 뒤 마지막에** 하세요. 인증서 발급은 4번이 끝나야 성공합니다.

## 1. 가비아 DNS 등록

1. 가비아 로그인 → **My가비아 → 서비스 관리 → 도메인 → sophiaschool.or.kr 관리 → DNS 관리**
2. **레코드 추가**
   - 타입: `A`
   - 호스트: `expense`
   - 값/위치: `1.217.30.146`
   - TTL: 기본값
3. 저장. 기존 `www` 레코드는 건드리지 마세요.

확인(Windows PowerShell): `nslookup expense.sophiaschool.or.kr` → 1.217.30.146이 나오면 됩니다. 반영에 몇 분~1시간이 걸릴 수 있습니다.

## 2. 서버 고정 내부 IP

공유기가 서버에 매번 같은 내부 주소를 주도록 합니다. 공유기 관리 화면의 **DHCP 고정 할당(주소 예약)**에서 Ubuntu 서버의 MAC 주소에 예: `192.168.0.50`을 지정하세요. 서버에서 `ip a` 명령으로 현재 주소와 MAC 주소를 볼 수 있습니다. 이 주소를 아래 4번과 6번에 씁니다.

## 3. Ubuntu 서버 설치

Ubuntu 22.04 이상, 서버에 로그인한 터미널에서 순서대로 실행합니다.

```bash
# 기본 도구와 Node.js 24 (node:sqlite를 플래그 없이 쓰려면 22.13 이상 필요)
sudo apt update && sudo apt install -y curl git ufw debian-keyring debian-archive-keyring apt-transport-https gpg
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# Caddy (HTTPS 자동 처리)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# 전용 계정과 폴더
sudo useradd --system --create-home --shell /bin/bash sophia
sudo mkdir -p /opt/sophia-cs /var/lib/sophia-cs /var/backups/sophia-cs
sudo chown sophia:sophia /opt/sophia-cs /var/lib/sophia-cs /var/backups/sophia-cs
sudo chmod 700 /var/lib/sophia-cs

# 프로그램 내려받기와 빌드
sudo -u sophia git clone https://github.com/secheonio/Sophia-CS.git /opt/sophia-cs
cd /opt/sophia-cs
sudo -u sophia npm ci
sudo -u sophia npm run build

# 서비스 등록과 시작
sudo cp deploy/sophia-cs.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sophia-cs
sudo systemctl status sophia-cs --no-pager      # active (running) 확인
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/api/me   # 401이 나오면 정상

# 방화벽: 웹(80/443)은 누구나, SSH(22)는 학교 내부망만
sudo ufw default deny incoming
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow from 192.168.0.0/24 to any port 22 proto tcp   # 내부망 대역에 맞게 수정
sudo ufw enable

# Caddy 설정 적용
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

> 데이터베이스 파일은 `/var/lib/sophia-cs/app.db`에 만들어집니다. 소스 폴더와 분리되어 있어 업데이트해도 지워지지 않습니다.

## 4. 공유기 포트 연결 (포트 포워딩)

공유기 관리 화면(보통 주소창에 `192.168.0.1`)에서 **포트 포워딩(가상 서버)** 메뉴를 찾아 두 줄을 추가합니다.

| 외부 포트 | 내부 IP | 내부 포트 | 프로토콜 |
|---|---|---|---|
| 80 | 192.168.0.50 | 80 | TCP |
| 443 | 192.168.0.50 | 443 | TCP |

- **22번 포트(SSH)는 절대 열지 마세요.**
- 기존에 80·443이 쿨메신저 서버 등 다른 장비로 연결되어 있다면 충돌합니다. 그 경우 설정하지 말고 알려 주세요.
- 연결 후 Caddy가 몇 분 안에 인증서를 자동 발급합니다. 확인: `sudo journalctl -u caddy -n 30 --no-pager`에 `certificate obtained successfully`가 보이면 성공입니다.
- 학교 내부에서 주소가 열리지 않고 외부(휴대폰 LTE 등)에서만 열린다면 공유기가 내부에서 공인 주소로 접속하는 것을 막는 경우입니다. 이때 알려 주세요.

## 5. 첫 교장 계정

```bash
cd /opt/sophia-cs
sudo -u sophia DATABASE_FILE=/var/lib/sophia-cs/app.db npm run create-admin -- "교장 이름" 교장이메일@예시.kr
```

비밀번호를 물으면 직접 입력합니다. 이후 브라우저에서 `https://expense.sophiaschool.or.kr`로 접속해 로그인하고, **사용자·직책** 화면에서 나머지 사용자를 추가합니다.

## 6. 백업

### 서버 쪽: 매일 새벽 3시 자동 백업 (30일 보관)

```bash
sudo chmod +x /opt/sophia-cs/deploy/backup.sh
echo '0 3 * * * sophia /opt/sophia-cs/deploy/backup.sh' | sudo tee /etc/cron.d/sophia-cs-backup
sudo -u sophia /opt/sophia-cs/deploy/backup.sh      # 지금 한 번 시험
ls -l /var/backups/sophia-cs
```

### Windows 학교 PC 쪽: 매일 내려받기

서버에 SSH로 접속하는 읽기 전용 열쇠를 만들어 Windows PC가 백업 파일만 가져가게 합니다.

1. Windows PowerShell에서 열쇠 만들기
   ```powershell
   ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\sophia_backup" -N '""'
   Get-Content "$env:USERPROFILE\.ssh\sophia_backup.pub"
   ```
2. 출력된 한 줄을 서버의 `/home/sophia/.ssh/authorized_keys`에 넣습니다.
   ```bash
   sudo -u sophia mkdir -p /home/sophia/.ssh && sudo chmod 700 /home/sophia/.ssh
   echo '여기에 공개키 한 줄 붙여넣기' | sudo -u sophia tee -a /home/sophia/.ssh/authorized_keys
   sudo chmod 600 /home/sophia/.ssh/authorized_keys
   ```
3. `deploy\pull-backup.ps1` 파일 위쪽의 서버 주소와 보관 폴더를 고치고, Windows PC에 복사한 뒤 한 번 실행해 파일이 내려오는지 확인합니다. 처음 접속 때는 `ssh sophia@192.168.0.50`을 한 번 직접 실행해 서버 지문을 승인해 두세요.
4. **작업 스케줄러**에서 매일 오전 4시에 `powershell -ExecutionPolicy Bypass -File "스크립트경로\pull-backup.ps1"`을 실행하도록 등록합니다.

### 복원

```bash
sudo systemctl stop sophia-cs
sudo -u sophia cp /var/lib/sophia-cs/app.db /var/lib/sophia-cs/app.db.before-restore   # 현재 상태 보관
sudo -u sophia cp /var/backups/sophia-cs/app-날짜시각.db /var/lib/sophia-cs/app.db
sudo rm -f /var/lib/sophia-cs/app.db-wal /var/lib/sophia-cs/app.db-shm
sudo systemctl start sophia-cs
```

Windows PC에서 받은 파일로 복원할 때는 먼저 `scp`로 서버에 올린 뒤 위와 같이 복사합니다. **배포 직후 한 번은 복원 연습을 해 보세요.**

## 업데이트 방법

```bash
cd /opt/sophia-cs
sudo -u sophia git pull
sudo -u sophia npm ci
sudo -u sophia npm run build
sudo systemctl restart sophia-cs
```

업데이트 전에 `sudo -u sophia /opt/sophia-cs/deploy/backup.sh`로 백업을 하나 더 만들어 두세요. OS 보안 업데이트는 `sudo apt update && sudo apt upgrade`로 한 달에 한 번 정도 하고, 필요하면 재부팅합니다(서비스는 자동으로 다시 시작됩니다).

## 문제가 생겼을 때

| 증상 | 확인 |
|---|---|
| 사이트가 안 열림 | `sudo systemctl status sophia-cs caddy` |
| 앱 오류 | `sudo journalctl -u sophia-cs -n 50 --no-pager` |
| 인증서 오류 | `sudo journalctl -u caddy -n 50 --no-pager`, DNS와 포트 80 연결 확인 |
| 로그인이 계속 실패 | 주소가 `https://`인지, 서버 시간이 맞는지(`timedatectl`) 확인 |
| 교장 비밀번호 분실 | 서버에서 DB를 직접 처리해야 하므로 알려 주세요 |
