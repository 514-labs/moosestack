"""
Unit tests for WebApp SDK functionality.
"""
import pytest
from moose_lib.dmv2 import WebApp, WebAppConfig, WebAppMetadata
from moose_lib.dmv2._registry import _web_apps


# Mock FastAPI app for testing
class MockFastAPIApp:
    """Mock FastAPI application for testing."""
    pass


@pytest.fixture(autouse=True)
def clear_registry():
    """Clear the WebApp registry before each test."""
    _web_apps.clear()
    yield
    _web_apps.clear()


def test_webapp_basic_creation():
    """Test basic WebApp creation with default config."""
    app = MockFastAPIApp()
    webapp = WebApp("test_app", app)

    assert webapp.name == "test_app"
    assert webapp.app is app
    assert webapp.config.mount_path is None
    assert webapp.config.inject_moose_utils is True
    assert "test_app" in _web_apps


def test_webapp_with_custom_mount_path():
    """Test WebApp with custom mount path."""
    app = MockFastAPIApp()
    config = WebAppConfig(mount_path="/myapi")
    webapp = WebApp("test_app", app, config)

    assert webapp.config.mount_path == "/myapi"


def test_webapp_with_metadata():
    """Test WebApp with metadata."""
    app = MockFastAPIApp()
    config = WebAppConfig(
        mount_path="/api",
        metadata=WebAppMetadata(description="My API"),
    )

    with pytest.raises(ValueError, match="cannot begin with a reserved path"):
        WebApp("test_app", app, config)

    # Now test with valid mount path
    config.mount_path = "/myapi"
    webapp = WebApp("test_app", app, config)
    assert webapp.config.metadata.description == "My API"


def test_webapp_duplicate_name():
    """Test that duplicate WebApp names are rejected."""
    app1 = MockFastAPIApp()
    app2 = MockFastAPIApp()

    WebApp("test_app", app1)

    with pytest.raises(ValueError, match="WebApp with name 'test_app' already exists"):
        WebApp("test_app", app2)


def test_webapp_trailing_slash_validation():
    """Test that trailing slashes are rejected."""
    app = MockFastAPIApp()
    config = WebAppConfig(mount_path="/myapi/")

    with pytest.raises(ValueError, match="mountPath cannot end with a trailing slash"):
        WebApp("test_app", app, config)


def test_webapp_root_path_allowed():
    """Test that root path '/' is allowed."""
    app = MockFastAPIApp()
    config = WebAppConfig(mount_path="/")
    webapp = WebApp("test_app", app, config)

    assert webapp.config.mount_path == "/"


def test_webapp_reserved_paths():
    """Test that reserved paths are rejected."""
    reserved_paths = [
        "/admin",
        "/api",
        "/consumption",
        "/health",
        "/ingest",
        "/moose",
        "/ready",
        "/workflows",
    ]

    for path in reserved_paths:
        app = MockFastAPIApp()
        config = WebAppConfig(mount_path=path)

        with pytest.raises(ValueError, match="cannot begin with a reserved path"):
            WebApp(f"test_{path}", app, config)


def test_webapp_reserved_path_prefix():
    """Test that paths starting with reserved prefixes are rejected."""
    app = MockFastAPIApp()
    config = WebAppConfig(mount_path="/api/v1")

    with pytest.raises(ValueError, match="cannot begin with a reserved path"):
        WebApp("test_app", app, config)


def test_webapp_duplicate_mount_path():
    """Test that duplicate mount paths are rejected."""
    app1 = MockFastAPIApp()
    app2 = MockFastAPIApp()

    config1 = WebAppConfig(mount_path="/myapi")
    WebApp("app1", app1, config1)

    config2 = WebAppConfig(mount_path="/myapi")
    with pytest.raises(ValueError, match='WebApp with mountPath "/myapi" already exists'):
        WebApp("app2", app2, config2)


def test_webapp_different_mount_paths():
    """Test that WebApps with different mount paths can coexist."""
    app1 = MockFastAPIApp()
    app2 = MockFastAPIApp()

    WebApp("app1", app1, WebAppConfig(mount_path="/api1"))
    WebApp("app2", app2, WebAppConfig(mount_path="/api2"))

    assert len(_web_apps) == 2


def test_webapp_inject_moose_utils_false():
    """Test WebApp with inject_moose_utils disabled."""
    app = MockFastAPIApp()
    config = WebAppConfig(inject_moose_utils=False)
    webapp = WebApp("test_app", app, config)

    assert webapp.config.inject_moose_utils is False


def test_webapp_repr():
    """Test WebApp string representation."""
    app = MockFastAPIApp()
    webapp = WebApp("test_app", app, WebAppConfig(mount_path="/myapi"))

    assert "test_app" in repr(webapp)
    assert "/myapi" in repr(webapp)


def test_webapp_default_mount_path_in_repr():
    """Test WebApp repr with default mount path."""
    app = MockFastAPIApp()
    webapp = WebApp("test_app", app)

    assert "test_app" in repr(webapp)
    assert "/" in repr(webapp)


def test_webapp_serialization():
    """Test that WebApps can be serialized via internal.py."""
    from moose_lib.internal import to_infra_map
    from moose_lib.dmv2 import get_web_apps

    app = MockFastAPIApp()
    WebApp(
        "test_app",
        app,
        WebAppConfig(
            mount_path="/myapi",
            metadata=WebAppMetadata(description="Test API")
        )
    )

    # Verify it's in the registry
    web_apps = get_web_apps()
    assert "test_app" in web_apps

    # Serialize to infra map
    infra_map = to_infra_map()

    assert "webApps" in infra_map
    assert "test_app" in infra_map["webApps"]
    assert infra_map["webApps"]["test_app"]["name"] == "test_app"
    assert infra_map["webApps"]["test_app"]["mountPath"] == "/myapi"
    assert infra_map["webApps"]["test_app"]["metadata"]["description"] == "Test API"


def test_webapp_serialization_default_mount_path():
    """Test WebApp serialization with default mount path."""
    from moose_lib.internal import to_infra_map

    app = MockFastAPIApp()
    WebApp("test_app", app)

    infra_map = to_infra_map()

    assert infra_map["webApps"]["test_app"]["mountPath"] == "/"


def test_webapp_serialization_no_metadata():
    """Test WebApp serialization without metadata."""
    from moose_lib.internal import to_infra_map

    app = MockFastAPIApp()
    WebApp("test_app", app, WebAppConfig(mount_path="/myapi"))

    infra_map = to_infra_map()

    assert infra_map["webApps"]["test_app"]["metadata"] is None
