# 배포 안내서 (학교 안 Ubuntu 서버)

주소: `https://expense.sophiaschool.or.kr` (학교 홈페이지 `www`는 그대로 두고 하위 주소만 추가)

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
