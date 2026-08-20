use std::{
    path::Path,
    process::{Command, Stdio},
};

pub fn compile_typescript_project(project: &Path) -> Result<(), String> {
    let root = project.parent().and_then(Path::parent).ok_or_else(|| {
        format!(
            "TypeScript project is not under the repository projects directory: {}",
            project.display()
        )
    })?;
    let script = root.join("scripts/build-typescript-project.ts");
    let status = Command::new("node")
        .arg("--import")
        .arg("tsx")
        .arg(&script)
        .arg(format!("--project={}", project.display()))
        .current_dir(root)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| {
            format!(
                "Could not start TypeScript compiler through {}: {error}",
                script.display()
            )
        })?;
    if !status.success() {
        return Err(format!(
            "TypeScript compilation failed for {} with {status}",
            project.display()
        ));
    }
    Ok(())
}
