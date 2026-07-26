# Sharp Lambda Layer

This directory contains the sharp image processing library compiled for AWS Lambda (Amazon Linux 2, Node.js 20.x).

## Building the Layer

```bash
# Build sharp for Lambda's Amazon Linux 2 environment
mkdir -p nodejs
cd nodejs
npm init -y
npm install --platform=linux --arch=x64 sharp
cd ..
zip -r sharp-layer.zip nodejs/
```

The compiled layer should be placed at:
```
infrastructure/layers/sharp/
└── nodejs/
    └── node_modules/
        └── sharp/
```

## Notes

- Sharp must be compiled specifically for Amazon Linux 2 (x86_64)
- The layer is referenced by `SiteRebuildFunction` in the SAM template
- Compatible runtime: nodejs20.x
