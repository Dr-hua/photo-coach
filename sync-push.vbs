' photo-coach auto push launcher - no visible window.
' Third arg True: wait for PowerShell, hand its exit code to Task Scheduler.
Dim shell, rc
Set shell = CreateObject("WScript.Shell")
rc = shell.Run("C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""D:\photo-coach-pages\sync-push.ps1""", 0, True)
Set shell = Nothing
WScript.Quit rc
