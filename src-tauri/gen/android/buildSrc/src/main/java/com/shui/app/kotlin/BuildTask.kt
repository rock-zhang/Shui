import java.io.File
import javax.inject.Inject
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction
import org.gradle.process.ExecOperations

/**
 * 调用 `tauri android android-studio-script` 生成 tauri.build.gradle.kts 并编译 Rust。
 *
 * 两点与 Tauri 模板不同，升级 Gradle 9 后必须保留：
 *  1. `project.exec` 在 Gradle 9 已移除，且打开 configuration-cache 后执行期禁止
 *     访问 project，因此注入 [ExecOperations] 并显式接收 `projectDir`。
 *  2. 子进程命令用 `yarn` 而不是模板的 `node tauri`：Tauri CLI 是本地
 *     devDependency，`yarn tauri` 才会从项目根解析 node_modules/.bin/tauri。
 */
abstract class BuildTask : DefaultTask() {
    @get:Inject
    abstract val execOperations: ExecOperations

    @Input
    var rootDirRel: String? = null
    @Input
    var projectDir: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val executable = """yarn""";
        try {
            runTauriCli(executable)
        } catch (e: Exception) {
            if (Os.isFamily(Os.FAMILY_WINDOWS)) {
                runTauriCli("$executable.cmd")
            } else {
                throw e;
            }
        }
    }

    fun runTauriCli(executable: String) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val projectDir = projectDir ?: throw GradleException("projectDir cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")

        val commandLine = mutableListOf("tauri", "android", "android-studio-script")
        if (logger.isEnabled(LogLevel.DEBUG)) {
            commandLine.add("-vv")
        } else if (logger.isEnabled(LogLevel.INFO)) {
            commandLine.add("-v")
        }
        if (release) {
            commandLine.add("--release")
        }
        commandLine.addAll(listOf("--target", target))

        execOperations.exec {
            workingDir(File(projectDir, rootDirRel))
            executable(executable)
            args(commandLine)
        }.assertNormalExitValue()
    }
}
