package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// interactiveConsole 跨平台交互式数字控制台 (Windows & Linux 通用)
func interactiveConsole() {
	scanner := bufio.NewScanner(os.Stdin)

	for {
		clearScreen()
		fmt.Println("=========================================================================")
		fmt.Println("                智能摸鱼云同步 - 综合管理控制台")
		fmt.Println("=========================================================================")
		fmt.Println(" 用户管理与数据看板:")
		fmt.Println("  [1]  查看所有用户数据看板 (会话数 / 存储占用 / 设备数 / 状态)")
		fmt.Println("  [2]  管理员直接创建新用户 (免邀请码，直接生成端到端派生账号)")
		fmt.Println("  [3]  修改指定用户备注说明 (如姓名、部门、用途)")
		fmt.Println("  [4]  调整指定用户存储配额 (单位: MB)")
		fmt.Println("  [5]  一键解除用户防撞库锁定 (输错5次密码快速解封)")
		fmt.Println("  [6]  启用 / 禁用指定用户账号 (冻结或解冻账号)")
		fmt.Println("  [7]  管理员重置用户登录密码 (强制重签登录会话)")
		fmt.Println("  [8]  清空指定用户的云端快照 (重置云盘空间，保留账号)")
		fmt.Println("  [9]  彻底注销并删除用户账号 (物理清理快照与用户所有数据)")
		fmt.Println()
		fmt.Println(" 邀请码管理:")
		fmt.Println("  [10] 生成新注册邀请码 (可指定天数与备注说明)")
		fmt.Println("  [11] 查看邀请码列表 (带明文、备注与使用账号)")
		fmt.Println("  [12] 作废指定的未使用的邀请码")
		fmt.Println()
		fmt.Println("  [0]  退出控制台")
		fmt.Println("=========================================================================")
		fmt.Print("请输入操作选项编号 [0-12]: ")

		if !scanner.Scan() {
			break
		}
		choice := strings.TrimSpace(scanner.Text())

		switch choice {
		case "0", "q", "exit":
			fmt.Println("已退出管理控制台。")
			return

		case "1":
			clearScreen()
			userCmd([]string{"list"})
			pauseWait(scanner)

		case "2":
			clearScreen()
			fmt.Println(">>> [2] 管理员直接创建新用户")
			fmt.Print("请输入新用户名 (3~32位字母/数字/下划线): ")
			if !scanner.Scan() {
				continue
			}
			username := strings.TrimSpace(scanner.Text())
			if username == "" {
				continue
			}

			fmt.Print("请输入初始密码 (至少6位): ")
			if !scanner.Scan() {
				continue
			}
			password := strings.TrimSpace(scanner.Text())
			if password == "" {
				continue
			}

			fmt.Print("请输入存储配额 (单位MB，直接回车默认 200): ")
			quota := "200"
			if scanner.Scan() {
				t := strings.TrimSpace(scanner.Text())
				if t != "" {
					quota = t
				}
			}

			fmt.Print("请输入用户备注 (可直接回车跳过): ")
			note := ""
			if scanner.Scan() {
				note = strings.TrimSpace(scanner.Text())
			}

			args := []string{"add", username, password, "-quota=" + quota}
			if note != "" {
				args = append(args, "-note="+note)
			}
			fmt.Println()
			userCmd(args)
			pauseWait(scanner)

		case "3":
			clearScreen()
			fmt.Println(">>> [3] 修改用户备注说明")
			fmt.Print("请输入目标用户名: ")
			if !scanner.Scan() {
				continue
			}
			username := strings.TrimSpace(scanner.Text())
			if username == "" {
				continue
			}

			fmt.Print("请输入新的备注内容: ")
			if !scanner.Scan() {
				continue
			}
			note := strings.TrimSpace(scanner.Text())

			fmt.Println()
			userCmd([]string{"note", username, note})
			pauseWait(scanner)

		case "4":
			clearScreen()
			fmt.Println(">>> [4] 调整用户存储配额")
			fmt.Print("请输入目标用户名: ")
			if !scanner.Scan() {
				continue
			}
			username := strings.TrimSpace(scanner.Text())
			if username == "" {
				continue
			}

			fmt.Print("请输入新的配额大小 (单位: MB，如 1024 代表 1GB): ")
			if !scanner.Scan() {
				continue
			}
			quota := strings.TrimSpace(scanner.Text())

			fmt.Println()
			userCmd([]string{"quota", username, quota})
			pauseWait(scanner)

		case "5":
			clearScreen()
			fmt.Println(">>> [5] 一键解除防撞库锁定")
			fmt.Print("请输入要解锁的目标用户名: ")
			if !scanner.Scan() {
				continue
			}
			username := strings.TrimSpace(scanner.Text())
			if username == "" {
				continue
			}

			fmt.Println()
			userCmd([]string{"unlock", username})
			pauseWait(scanner)

		case "6":
			clearScreen()
			fmt.Println(">>> [6] 启用 / 禁用指定用户")
			fmt.Print("请输入目标用户名: ")
			if !scanner.Scan() {
				continue
			}
			username := strings.TrimSpace(scanner.Text())
			if username == "" {
				continue
			}

			fmt.Println("请选择操作:")
			fmt.Println("  [1] 恢复启用该用户")
			fmt.Println("  [2] 冻结禁用该用户")
			fmt.Print("请选择 [1 或 2]: ")
			if !scanner.Scan() {
				continue
			}
			act := strings.TrimSpace(scanner.Text())
			fmt.Println()
			if act == "1" {
				userCmd([]string{"enable", username})
			} else if act == "2" {
				userCmd([]string{"disable", username})
			} else {
				fmt.Println("无效的选择。")
			}
			pauseWait(scanner)

		case "7":
			clearScreen()
			fmt.Println(">>> [7] 管理员重置用户登录密码")
			fmt.Print("请输入目标用户名: ")
			if !scanner.Scan() {
				continue
			}
			username := strings.TrimSpace(scanner.Text())
			if username == "" {
				continue
			}

			fmt.Print("请输入新的登录密码 (至少6位): ")
			if !scanner.Scan() {
				continue
			}
			newPwd := strings.TrimSpace(scanner.Text())

			fmt.Println()
			userCmd([]string{"reset-pwd", username, newPwd})
			pauseWait(scanner)

		case "8":
			clearScreen()
			fmt.Println(">>> [8] 清空指定用户的云端快照数据")
			fmt.Println("警告: 此操作将物理删除该用户上传的所有云端备份文件，但保留账号密码与设备凭据。")
			fmt.Print("请输入目标用户名: ")
			if !scanner.Scan() {
				continue
			}
			username := strings.TrimSpace(scanner.Text())
			if username == "" {
				continue
			}

			fmt.Print("确认清空该用户的云端快照吗？(输入 Y 确认，其他键取消): ")
			if !scanner.Scan() {
				continue
			}
			confirm := strings.TrimSpace(scanner.Text())
			if strings.ToUpper(confirm) != "Y" {
				fmt.Println("已取消操作。")
			} else {
				fmt.Println()
				userCmd([]string{"clear", username})
			}
			pauseWait(scanner)

		case "9":
			clearScreen()
			fmt.Println(">>> [9] 彻底注销并删除用户账号")
			fmt.Println("高危警告: 此操作将物理彻底删除用户账号、所有设备授权、审计日志以及所有云端快照！不可恢复！")
			fmt.Print("请输入目标用户名: ")
			if !scanner.Scan() {
				continue
			}
			username := strings.TrimSpace(scanner.Text())
			if username == "" {
				continue
			}

			fmt.Print("确认彻底删除该用户吗？(输入 Y 确认，其他键取消): ")
			if !scanner.Scan() {
				continue
			}
			confirm := strings.TrimSpace(scanner.Text())
			if strings.ToUpper(confirm) != "Y" {
				fmt.Println("已取消操作。")
			} else {
				fmt.Println()
				userCmd([]string{"delete", username})
			}
			pauseWait(scanner)

		case "10":
			clearScreen()
			fmt.Println(">>> [10] 生成新注册邀请码")
			fmt.Print("请输入有效期天数 (直接回车默认 7 天): ")
			days := "7"
			if scanner.Scan() {
				t := strings.TrimSpace(scanner.Text())
				if t != "" {
					days = t
				}
			}

			fmt.Print("请输入邀请码备注 (如发给张三，直接回车跳过): ")
			note := ""
			if scanner.Scan() {
				note = strings.TrimSpace(scanner.Text())
			}

			args := []string{"create", "-days=" + days}
			if note != "" {
				args = append(args, "-note="+note)
			}
			fmt.Println()
			inviteCmd(args)
			pauseWait(scanner)

		case "11":
			clearScreen()
			inviteCmd([]string{"list"})
			pauseWait(scanner)

		case "12":
			clearScreen()
			fmt.Println(">>> [12] 作废指定的未使用的邀请码")
			fmt.Print("请输入要作废的 32 位邀请码: ")
			if !scanner.Scan() {
				continue
			}
			code := strings.TrimSpace(scanner.Text())
			if code == "" {
				continue
			}

			fmt.Println()
			inviteCmd([]string{"revoke", code})
			pauseWait(scanner)

		default:
			fmt.Println("无效选项，请重新输入。")
			pauseWait(scanner)
		}
	}
}

func pauseWait(scanner *bufio.Scanner) {
	fmt.Println()
	fmt.Print("按 [回车键] 返回主菜单...")
	_ = scanner.Scan()
}

func clearScreen() {
	if runtime.GOOS == "windows" {
		cmd := exec.Command("cmd", "/c", "cls")
		cmd.Stdout = os.Stdout
		_ = cmd.Run()
	} else {
		// Linux / macOS ANSI 清屏
		fmt.Print("\033[H\033[2J")
	}
}
