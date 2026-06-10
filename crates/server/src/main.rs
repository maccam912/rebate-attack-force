use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);
    let dev_hooks = std::env::var("DEV_HOOKS").map(|v| v == "1").unwrap_or(false);
    let seed = std::env::var("SEED").ok().and_then(|s| s.parse().ok());
    let dist = std::env::var("CLIENT_DIST").unwrap_or_else(|_| "dist".to_string());

    let state = server::new_state(dev_hooks, seed);
    let app = server::build_router(state, &dist);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("rebate-attack-force server on http://{addr} (dist: {dist}, dev_hooks: {dev_hooks})");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
