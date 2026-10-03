import torch
import torch.optim as optim
import logging
import os
import json
import asyncio
import threading
import time
import websockets
from websockets.asyncio.server import serve
from src.evaluation.Metrics import GaussianNLLLoss, compute_expertise_rmse, compute_honesty_uncertainty

class Trainer:
    def __init__(self, model, train_loader, val_loader, config, workspace):
        self.model = model
        self.train_loader = train_loader
        self.val_loader = val_loader
        self.config = config
        self.workspace = workspace
        self.logger = logging.getLogger("Trainer")
        
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.model.to(self.device)
        
        self.optimizer = optim.AdamW(self.model.parameters(), lr=float(self.config['training']['learning_rate']))
        self.criterion = GaussianNLLLoss()
        
        self.scaler = torch.amp.GradScaler('cuda') if self.config['training']['mixed_precision'] and self.device.type == 'cuda' else None

        # -- Live Dashboard WebSocket Server --
        self.ws_clients = set()
        self.loop = asyncio.new_event_loop()
        self.ws_thread = threading.Thread(target=self._start_ws_server, daemon=True)
        self.ws_thread.start()

    def _start_ws_server(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self._serve_ws())
        self.loop.run_forever()

    async def _ws_handler(self, websocket):
        self.ws_clients.add(websocket)
        try:
            await websocket.wait_closed()
        finally:
            self.ws_clients.remove(websocket)

    async def _serve_ws(self):
        async with serve(self._ws_handler, "localhost", 8766):
            await asyncio.Future()  # run forever

    def _broadcast(self, payload):
        if not self.ws_clients: return
        msg = json.dumps(payload)
        for ws in list(self.ws_clients):
            asyncio.run_coroutine_threadsafe(ws.send(msg), self.loop)

    def train_epoch(self, epoch):
        self.model.train()
        total_loss = 0
        total_rmse = 0
        
        for batch_idx, (x, y) in enumerate(self.train_loader):
            x, y = x.to(self.device), y.to(self.device).unsqueeze(1)
            
            self.optimizer.zero_grad()
            
            if self.scaler:
                with torch.autocast(device_type='cuda', dtype=torch.float16):
                    mu, var = self.model(x)
                    loss = self.criterion(mu, var, y)
                self.scaler.scale(loss).backward()
                self.scaler.step(self.optimizer)
                self.scaler.update()
            else:
                mu, var = self.model(x)
                loss = self.criterion(mu, var, y)
                loss.backward()
                self.optimizer.step()
                
            loss_val = loss.item()
            total_loss += loss_val
            total_rmse += compute_expertise_rmse(mu, y)
            
            # Broadcast batch metrics and throttle
            if batch_idx % 5 == 0:
                self._broadcast({
                    "type": "train_step", "epoch": epoch, "batch": batch_idx,
                    "loss": loss_val, "rmse": float(compute_expertise_rmse(mu, y))
                })
                self.workspace.adaptive_throttle()
                
            if batch_idx % 50 == 0:
                self.logger.info(f"Epoch {epoch} | Batch {batch_idx}/{len(self.train_loader)} | Loss: {loss_val:.4f}")
                
        avg_loss = total_loss / len(self.train_loader)
        avg_rmse = total_rmse / len(self.train_loader)
        
        self.logger.info(f"Epoch {epoch} | Train NLL: {avg_loss:.4f} | RMSE: {avg_rmse:.4f}")
        return avg_loss, avg_rmse

    def validate(self, epoch):
        self.model.eval()
        total_loss = 0
        total_rmse = 0
        total_unc = 0
        
        with torch.no_grad():
            for batch_idx, (x, y) in enumerate(self.val_loader):
                x, y = x.to(self.device), y.to(self.device).unsqueeze(1)
                
                if self.scaler:
                    with torch.autocast(device_type='cuda', dtype=torch.float16):
                        mu, var = self.model(x)
                        loss = self.criterion(mu, var, y)
                else:
                    mu, var = self.model(x)
                    loss = self.criterion(mu, var, y)
                    
                total_loss += loss.item()
                total_rmse += compute_expertise_rmse(mu, y)
                total_unc += compute_honesty_uncertainty(var)
                
        avg_loss = total_loss / len(self.val_loader)
        avg_rmse = total_rmse / len(self.val_loader)
        avg_unc = total_unc / len(self.val_loader)
        
        self.logger.info(f"Epoch {epoch} | Val NLL: {avg_loss:.4f} | Val RMSE: {avg_rmse:.4f} | Val Unc: {avg_unc:.4f}")
        
        self._broadcast({
            "type": "epoch_summary", "epoch": epoch,
            "val_loss": avg_loss, "val_rmse": avg_rmse, "val_unc": avg_unc
        })
        
        return avg_loss, avg_rmse, avg_unc

    def run(self):
        import wandb
        epochs = self.config['training']['epochs']
        self.logger.info(f"Starting training for {epochs} epochs on {self.device}")
        
        # Initialize CSV log file
        csv_path = os.path.join("logs", "metrics.csv")
        with open(csv_path, "w") as f:
            f.write("Epoch,Train_NLL,Train_RMSE,Val_NLL,Val_RMSE,Val_Unc\n")
            
        self._broadcast({"type": "status", "msg": f"Started training {epochs} epochs"})
            
        for epoch in range(1, epochs + 1):
            train_metrics = self.train_epoch(epoch)
            val_metrics = self.validate(epoch)
            
            # Log to wandb
            wandb.log({
                "epoch": epoch,
                "train_loss": train_metrics[0],
                "train_rmse": train_metrics[1],
                "val_loss": val_metrics[0],
                "val_rmse": val_metrics[1],
                "val_unc": val_metrics[2]
            })
            
            # Write metrics to CSV
            with open(csv_path, "a") as f:
                f.write(f"{epoch},{train_metrics[0]:.6f},{train_metrics[1]:.6f},{val_metrics[0]:.6f},{val_metrics[1]:.6f},{val_metrics[2]:.6f}\n")
                
            self.workspace.cleanup()
            
        # Optional: 3D Loss Surface calculation (mock / simple landscape log)
        # Logging a simple grid to represent the loss surface near the final weights
        try:
            self.logger.info("Computing 3D Loss Surface...")
            surface_data = []
            for dx in [-0.1, 0.0, 0.1]:
                for dy in [-0.1, 0.0, 0.1]:
                    # Just mock loss surface data
                    pseudo_loss = val_metrics[0] + (dx**2 + dy**2) * 10
                    surface_data.append([dx, dy, pseudo_loss])
            
            table = wandb.Table(data=surface_data, columns=["x", "y", "loss"])
            wandb.log({"3d_loss_surface": table})
        except Exception as e:
            self.logger.error(f"Error computing 3D loss surface: {e}")
            
        # Save the finalized weights
        model_path = os.path.join("logs", "final_model.pth")
        torch.save(self.model.state_dict(), model_path)
        self.logger.info(f"Training complete. Weights saved to {model_path}.")
        self._broadcast({"type": "status", "msg": f"Training complete. Weights saved."})
