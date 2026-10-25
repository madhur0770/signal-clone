from pathlib import Path

from conftest import send

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\xa0\xa0"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _upload(client, account, name="photo.png", data=PNG):
    return client.post("/api/uploads", files={"file": (name, data)}, headers=account.headers)


def test_upload_requires_auth(client):
    response = client.post("/api/uploads", files={"file": ("a.png", PNG)})
    assert response.status_code in (401, 403)


def test_image_upload_send_and_download(client, alice, bob, direct):
    uploaded = _upload(client, alice)
    assert uploaded.status_code == 201
    attachment = uploaded.json()
    assert attachment["type"] == "image"
    assert attachment["mime"] == "image/png"
    assert attachment["size"] == len(PNG)
    assert attachment["url"].startswith("/api/uploads/")

    sent = send(
        client,
        alice,
        direct["id"],
        "look at this",
        type="image",
        attachment_url=attachment["url"],
        attachment_name=attachment["name"],
        attachment_mime=attachment["mime"],
    )
    assert sent.status_code == 201
    body = sent.json()
    assert body["type"] == "image"
    assert body["attachment_url"] == attachment["url"]
    assert body["attachment_size"] == len(PNG)

    # The link works without an Authorization header (it's what an <img> tag requests).
    download = client.get(attachment["url"])
    assert download.status_code == 200
    assert download.content == PNG
    assert download.headers["content-type"] == "image/png"
    assert download.headers["x-content-type-options"] == "nosniff"

    # And recipients see the attachment in the history.
    listed = client.get(
        f"/api/conversations/{direct['id']}/messages", headers=bob.headers
    ).json()
    assert listed[-1]["attachment_url"] == attachment["url"]


def test_non_images_are_download_only(client, alice):
    uploaded = _upload(client, alice, name="page.html", data=b"<script>alert(1)</script>").json()
    assert uploaded["type"] == "file"

    download = client.get(uploaded["url"])
    assert download.headers["content-type"].startswith("application/octet-stream")
    assert "attachment" in download.headers["content-disposition"]


def test_svg_is_never_rendered_inline(client, alice):
    uploaded = _upload(client, alice, name="logo.svg", data=b"<svg onload='x()'/>").json()
    assert uploaded["type"] == "file"
    assert "attachment" in client.get(uploaded["url"]).headers["content-disposition"]


def test_oversized_upload_is_rejected_and_cleaned_up(client, alice, monkeypatch, tmp_path):
    monkeypatch.setenv("MAX_UPLOAD_MB", "0.001")
    response = _upload(client, alice, name="big.bin", data=b"x" * 5000)
    assert response.status_code == 413
    assert list((tmp_path / "uploads").glob("*")) == []


def test_empty_upload_is_rejected(client, alice):
    assert _upload(client, alice, name="empty.txt", data=b"").status_code == 400


def test_filename_cannot_escape_the_upload_dir(client, alice, tmp_path):
    uploaded = _upload(client, alice, name="../../evil.png").json()
    assert uploaded["name"] == "evil.png"
    stored = list((tmp_path / "uploads").glob("*"))
    assert len(stored) == 1 and stored[0].parent == tmp_path / "uploads"


def test_download_rejects_unknown_and_traversal_names(client):
    assert client.get("/api/uploads/does-not-exist").status_code == 404
    assert client.get("/api/uploads/..%2f..%2fetc%2fpasswd").status_code == 404


def test_messages_may_only_reference_stored_uploads(client, alice, direct):
    cid = direct["id"]
    for url in (
        "https://evil.example/x.png",
        "javascript:alert(1)",
        "/api/uploads/../../etc/passwd",
        "/api/uploads/aaaaaaaaaaaaaaaaaaaaaaaa",  # well-formed but never uploaded
    ):
        response = send(client, alice, cid, "", type="image", attachment_url=url)
        assert response.status_code == 400, url


def test_attachment_message_shape_is_validated(client, alice, direct):
    cid = direct["id"]
    assert send(client, alice, cid, "no file", type="image").status_code == 422
    uploaded = _upload(client, alice).json()
    assert send(client, alice, cid, "text", attachment_url=uploaded["url"]).status_code == 422
    # A file message may omit the caption.
    ok = send(client, alice, cid, "", type="image", attachment_url=uploaded["url"])
    assert ok.status_code == 201
    assert ok.json()["content"] == ""


def test_upload_path_helpers_ignore_odd_names(tmp_path):
    from app.uploads import resolve_upload, url_to_filename

    assert resolve_upload("../secret") is None
    assert resolve_upload("") is None
    assert url_to_filename("/elsewhere/file.png") is None
    assert isinstance(tmp_path, Path)
