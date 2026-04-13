$root = "C:\Users\user\Desktop\emm ess final project contract\smart-marketplace"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; deno run --allow-net --allow-env --allow-read auth/main.ts"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; deno run --allow-net --allow-env --allow-read products/main.ts"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; deno run --allow-net --allow-env --allow-read orders/main.ts"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; deno run --allow-net --allow-env --allow-read users/main.ts"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; deno run --allow-net --allow-env --allow-read search/main.ts"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\ml'; .venv\Scripts\activate; cd recommender; python api.py"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\ml'; .venv\Scripts\activate; cd forecasting; python api.py"

Write-Host "All 7 services starting..."