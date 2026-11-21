; Windows 安装钩子：记录安装来源渠道。
;
; winget 等静默分发可以在命令行追加 /CHANNEL=xxx（见 winget manifest 的
; InstallerSwitches.Custom），安装完把值写到应用数据目录下的 install-channel，
; 应用首次上报 GA4 时读取为 install_channel 维度。
;
; 没有该参数时什么都不写：自动更新会重新跑一遍安装器且不带渠道参数，
; 若这里写空值就会把用户原来的渠道标记覆盖掉。

!include "FileFunc.nsh"

!macro NSIS_HOOK_POSTINSTALL
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5

  ${GetParameters} $R0
  StrCpy $R1 ""
  StrCpy $R3 0
  StrLen $R2 "/CHANNEL="

  ShuiChannelLoop:
    StrCpy $R4 "$R0" $R2 $R3
    StrCmp $R4 "" ShuiChannelWrite
    StrCmp $R4 "/CHANNEL=" ShuiChannelFound
    IntOp $R3 $R3 + 1
    Goto ShuiChannelLoop

  ShuiChannelFound:
    IntOp $R3 $R3 + $R2
  ShuiChannelValue:
    StrCpy $R5 "$R0" 1 $R3
    StrCmp $R5 "" ShuiChannelWrite
    StrCmp $R5 " " ShuiChannelWrite
    StrCmp $R5 '"' ShuiChannelWrite
    StrCpy $R1 "$R1$R5"
    IntOp $R3 $R3 + 1
    Goto ShuiChannelValue

  ShuiChannelWrite:
    StrCmp $R1 "" ShuiChannelDone
    CreateDirectory "$APPDATA\com.shui.app"
    FileOpen $R2 "$APPDATA\com.shui.app\install-channel" w
    FileWrite $R2 $R1
    FileClose $R2

  ShuiChannelDone:

  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend
