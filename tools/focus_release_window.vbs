Option Explicit
Dim shell, ok
Set shell = CreateObject("WScript.Shell")
ok = shell.AppActivate("Auto3Dvideo Studio")
If ok Then
  WScript.Sleep 500
  shell.SendKeys "%{TAB}"
  WScript.Sleep 300
  shell.SendKeys "%{TAB}"
  WScript.Echo "WINDOW_FOCUSED=1"
Else
  WScript.Echo "WINDOW_FOCUSED=0"
End If
