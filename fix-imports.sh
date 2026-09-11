#!/bin/bash

# Fix inside utils/
cd apps/backend/src/utils/
sed -i '' "s/'\.\/sandbox'/'\.\.\/sandbox'/g" *.ts
sed -i '' "s/'\.\/config'/'\.\.\/config'/g" *.ts
sed -i '' "s/'\.\/providers'/'\.\.\/providers'/g" *.ts
cd ../../../..

# Fix root src files
cd apps/backend/src/
sed -i '' "s/'\.\/events'/'\.\/utils\/events'/g" *.ts
sed -i '' "s/'\.\/naming'/'\.\/utils\/naming'/g" *.ts
sed -i '' "s/'\.\/http'/'\.\/utils\/http'/g" *.ts
sed -i '' "s/'\.\/verify'/'\.\/utils\/verify'/g" *.ts
sed -i '' "s/'\.\/secrets'/'\.\/utils\/secrets'/g" *.ts
sed -i '' "s/'\.\/snapshot'/'\.\/utils\/snapshot'/g" *.ts
cd ../../..

# Fix tools
cd apps/backend/src/tools/
sed -i '' "s/'\.\.\/secrets'/'\.\.\/utils\/secrets'/g" *.ts
cd ../../../..

# Fix index.ts
cd apps/backend/
sed -i '' "s/'\.\/src\/events'/'\.\/src\/utils\/events'/g" index.ts
sed -i '' "s/'\.\/src\/naming'/'\.\/src\/utils\/naming'/g" index.ts
sed -i '' "s/'\.\/src\/http'/'\.\/src\/utils\/http'/g" index.ts
sed -i '' "s/'\.\/src\/verify'/'\.\/src\/utils\/verify'/g" index.ts
sed -i '' "s/'\.\/src\/secrets'/'\.\/src\/utils\/secrets'/g" index.ts
sed -i '' "s/'\.\/src\/snapshot'/'\.\/src\/utils\/snapshot'/g" index.ts
cd ../..
