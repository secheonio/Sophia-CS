# 학교 Ubuntu 서버 원격 접속 가이드

이 문서는 집 노트북에서 학교 서버에 접속해 관리할 수 있도록 하는 절차를 정리한 문서입니다.

현재 기준
- 집 노트북: Windows 또는 macOS/Linux
- 학교 서버: Ubuntu, 사용자 `scipark`
- 서버 IP 예시: `192.168.1.50`
- LAN 게이트웨이 예시: `192.168.1.254`
- 운영 방식: SSH + VS Code Remote SSH + GitHub + Cloudflare Tunnel

## 1. 가장 추천하는 방식

가장 실용적인 조합은 다음입니다.

- 집 노트북에서 VS Code로 작업
- GitHub에 코드 저장
- 학교 서버에 SSH 접속
- 서버에서 앱 실행 및 로그 확인
- 브라우저 공개는 Cloudflare Tunnel로 처리

이 방식은 보안과 편의성 모두 좋습니다.

## 2. 학교 서버 보안 기본 설정

학교 서버에 직접 로그인한 뒤 아래를 실행합니다.

```bash
whoami
hostname
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw ca-certificates gnupg openssh-server
```

SSH 서버가 켜졌는지 확인합니다.

```bash
sudo systemctl status ssh --no-pager
```

만약 비활성화돼 있으면 켭니다.

```bash
sudo systemctl enable --now ssh
sudo systemctl status ssh --no-pager
```

방화벽 규칙을 설정합니다.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw enable
sudo ufw status
```

> 22번 포트를 외부에서 직접 공개하는 것은 보통 권장하지 않습니다. 내부망에서만 접근하거나 VPN/Cloudflare Tunnel을 이용하는 방식이 안전합니다.

## 3. 집 노트북에서 SSH 키 생성

집 노트북에서 PowerShell 또는 터미널을 열고 아래를 실행합니다.

### Windows PowerShell

```powershell
ssh-keygen -t ed25519 -C "scipark@home"
```

기본 위치는 보통 아래입니다.

```powershell
$env:USERPROFILE\.ssh\id_ed25519.pub
```

공개키 내용을 확인합니다.

```powershell
Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub"
```

### macOS/Linux

```bash
ssh-keygen -t ed25519 -C "scipark@home"
cat ~/.ssh/id_ed25519.pub
```

이 공개키 한 줄을 복사해 둡니다.

## 4. 서버에 SSH 공개키 등록

학교 서버에 로그인한 뒤 아래를 실행합니다.

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
```

공개키를 서버에 추가합니다.

```bash
nano ~/.ssh/authorized_keys
```

복사해 둔 공개키를 붙여 넣고 저장합니다.

```bash
chmod 600 ~/.ssh/authorized_keys
```

이제 비밀번호 입력 없이 SSH 접속이 가능해집니다.

## 5. 집 노트북에서 서버로 SSH 접속

### 기본 방식

```bash
ssh scipark@192.168.1.50
```

처음 연결할 때는 서버 지문을 확인하는 메시지가 뜰 수 있습니다. 그때는 yes를 입력합니다.

### SSH 키를 사용할 때

```bash
ssh -i ~/.ssh/id_ed25519 scipark@192.168.1.50
```

### config 파일로 편하게 접속

집 노트북에서 `~/.ssh/config`를 만듭니다.

#### Windows PowerShell
```powershell
notepad $env:USERPROFILE\.ssh\config
```

#### macOS/Linux
```bash
nano ~/.ssh/config
```

내용 예시:

```sshconfig
Host school-server
    HostName 192.168.1.50
    User scipark
    Port 22
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
```

그다음은 이렇게 접속합니다.

```bash
ssh school-server
```

## 6. 서버에서 SSH 보안 강화

`/etc/ssh/sshd_config`를 수정해 보안 수준을 높입니다.

```bash
sudo nano /etc/ssh/sshd_config
```

추천 설정:

```bash
PasswordAuthentication no
PubkeyAuthentication yes
ChallengeResponseAuthentication no
UsePAM yes
X11Forwarding no
PermitRootLogin no
```

설정 반영:

```bash
sudo systemctl restart ssh
sudo systemctl status ssh --no-pager
```

## 7. VS Code Remote SSH 설정

집 노트북에서 VS Code를 엽니다.

1. 확장 프로그램 설치
   - Remote - SSH
2. 좌측 하단의 원격 연결 버튼 클릭
3. `Connect to Host...` 선택
4. `school-server` 선택
5. 연결 시도

연결되면 VS Code는 학교 서버의 파일 시스템을 로컬처럼 다룰 수 있습니다.

### 장점
- 서버 파일을 직접 편집 가능
- 터미널에서 서버 명령 실행 가능
- 서버 폴더를 열고 개발 가능

### 사용 예시

- 서버 폴더 열기: `/opt/sophia-cs`
- 터미널 열기: `Ctrl + `
- 서버에서 `git pull`, `npm ci`, `npm run build` 실행 가능

## 8. 학교 서버를 집에서 관리할 때 가장 좋은 흐름

일반적인 흐름은 다음과 같습니다.

1. 집 노트북에서 코드 수정
2. GitHub에 push
3. SSH로 학교 서버 연결
4. 서버에서 `git pull`
5. `npm ci` / `npm run build`
6. `systemctl restart sophia-cs`
7. 브라우저로 서비스 확인
8. 다시 수정 반복

예시:

```bash
ssh school-server
cd /opt/sophia-cs
git pull
npm ci
npm run build
sudo systemctl restart sophia-cs
sudo journalctl -u sophia-cs -n 50 --no-pager
```

## 9. SSH 접속이 안 될 때 점검

아래 순서로 확인합니다.

### 서버 쪽 확인

```bash
sudo systemctl status ssh --no-pager
sudo ss -tulpn | grep 22
sudo ufw status
```

### 네트워크 확인

```bash
ip a
ip route
ping -c 4 8.8.8.8
```

### 로컬에서 확인

집 노트북에서:

```bash
ssh -vvv scipark@192.168.1.50
```

- IP가 맞는지
- SSH 서버가 켜져 있는지
- 방화벽이 막고 있는지
- 키 파일이 올바른지

이렇게 확인하면 대부분 해결됩니다.

## 10. 보안 권장 사항

- 비밀번호 로그인은 비활성화
- 정적 IP 또는 내부망에서만 SSH 허용
- SSH 키만 사용
- 서버 계정은 최소 권한으로 사용
- 루트 로그인 비활성화
- 22번 포트를 외부로 공개하지 않기
- 필요시 VPN 또는 Cloudflare Tunnel 사용

## 11. 가장 추천하는 최종 조합

실무적으로 가장 추천하는 구성은 다음입니다.

- 서버: Ubuntu, 내부 LAN에 위치
- 접속: SSH + VS Code Remote SSH
- 코드 저장: GitHub
- 배포: 서버에서 git pull 후 build/restart
- 외부 공개: Cloudflare Tunnel
- 보안: SSH 키 기반 인증

이 조합이 가장 안전하고, 개발/배포/운영을 함께 처리하기 좋습니다.

## 12. 결론

집 노트북에서 학교 서버를 제어하는 건 가능합니다.

- SSH 접속으로 서버를 관리
- VS Code Remote SSH로 서버 폴더를 직접 편집
- GitHub로 코드 버전 관리
- Cloudflare Tunnel로 외부 서비스 공개

이 방식은 학교에서 운영 중인 서버를 집에서 안전하게 관리하는 표준적인 방식입니다.

다음으로는 실제로 서버에 접속해서 앱을 배포하는 절차를 이어서 정리하면 됩니다.
