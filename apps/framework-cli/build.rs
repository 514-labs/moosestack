use std::io::Result;

fn main() -> Result<()> {
    println!("cargo:rerun-if-changed=../../packages/protobuf");

    // Pass PostHog API key from environment variable at build time
    if let Ok(posthog_api_key) = std::env::var("POSTHOG_API_KEY") {
        println!("cargo:rustc-env=POSTHOG_API_KEY={posthog_api_key}");
    }
    println!("cargo:rerun-if-env-changed=POSTHOG_API_KEY");

    // Generate protobuf code
    std::fs::create_dir_all("src/proto/")?;
    protobuf_codegen::Codegen::new()
        .pure()
        .includes(["../../packages/protobuf"])
        .input("../../packages/protobuf/infrastructure_map.proto")
        .out_dir("src/proto/")
        .run_from_script();

    Ok(())
}
