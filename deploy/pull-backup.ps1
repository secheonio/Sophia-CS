# Windows 학교 PC에서 실행합니다. 서버의 백업 폴더를 이 PC로 내려받습니다.
# 작업 스케줄러에 매일 실행하도록 등록하세요 (docs/deployment.md 참고).
$ErrorActionPreference = 'Stop'
$ServerHost = 'sophia@192.168.0.50'            # Ubuntu 서버의 내부 주소로 바꾸세요
$Key = "$env:USERPROFILE\.ssh\sophia_backup"   # 백업 전용 SSH 키
$Dest = 'D:\Backups\Sophia-CS'                 # 백업을 보관할 폴더
$KeepDays = 90

New-Item -ItemType Directory -Force $Dest | Out-Null
scp -i $Key -o BatchMode=yes -o StrictHostKeyChecking=yes "${ServerHost}:/var/backups/sophia-cs/app-*.db" $Dest
if ($LASTEXITCODE -ne 0) { throw 'scp 실패: 서버 연결과 키를 확인하세요.' }

Get-ChildItem $Dest -Filter 'app-*.db' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
  Remove-Item -Force
Write-Host "백업 내려받기 완료: $Dest"
