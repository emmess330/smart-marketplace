$root = "C:\Users\user\Desktop\emm ess final project contract\smart-marketplace"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; deno run --allow-net --allow-env --allow-read --env-file=.env auth/main.ts"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; deno run --allow-net --allow-env --allow-read --env-file=.env products/main.ts"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; deno run --allow-net --allow-env --allow-read --env-file=.env orders/main.ts"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; deno run --allow-net --allow-env --allow-read --env-file=.env users/main.ts"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; deno run --allow-net --allow-env --allow-read --env-file=.env search/main.ts"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\ml'; .venv\Scripts\activate; cd recommender; python api.py"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\ml'; .venv\Scripts\activate; cd forecasting; python api.py"

Write-Host "All 7 services starting..."