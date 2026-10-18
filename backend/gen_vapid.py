"""Create VAPID keys for Web Push. Run once:  python gen_vapid.py"""
import base64
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

key = ec.generate_private_key(ec.SECP256R1())
pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)

Path("vapid_private.pem").write_bytes(pem)
print("Wrote vapid_private.pem (keep it secret, it is gitignored).\n")
print("Public key (the app fetches this from /api/push/key):")
print(base64.urlsafe_b64encode(pub).rstrip(b"=").decode(), "\n")
print("For hosts that only have env vars, set this instead of the file:")
print("VAPID_PRIVATE_KEY_PEM=" + pem.decode().strip().replace("\n", "\\n"))
