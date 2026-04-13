Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; deno run --allow-net --allow-env --allow-read auth/main.ts"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; deno run --allow-net --allow-env --allow-read products/main.ts"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; deno run --allow-net --allow-env --allow-read orders/main.ts"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; deno run --allow-net --allow-env --allow-read users/main.ts"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; deno run --allow-net --allow-env --allow-read search/main.ts"
Write-Host "All services starting..."

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'C:\Users\user\Desktop\emm ess final project contract\smart-marketplace\ml'; .venv\Scripts\activate; cd forecasting; python api.py"
Write-Host "Forecasting service starting..."