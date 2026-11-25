# Test TLS material

`relay-cert.pem` and `relay-key.pem` are a throwaway self-signed pair, generated once for the
host's `wss://` tests. They are not a product key, are never packaged, and must not be used to
serve a real relay.

Regenerate only if the pair is lost; the fingerprint assertion in `../tls.test.ts` changes with it:

```sh
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout relay-key.pem -out relay-cert.pem -days 36500 \
  -subj "/CN=suite-sync test relay" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```
