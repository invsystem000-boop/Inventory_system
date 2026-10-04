$taskName = "InventoryDemoServer"
$scriptPath = "C:\Users\Administrator\OneDrive\Desktop\Trial\run-server.bat"
$action = New-ScheduledTaskAction -Execute $scriptPath
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force
Write-Output "Scheduled task '$taskName' registered to run '$scriptPath' at logon."