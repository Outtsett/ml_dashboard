import si from 'systeminformation';

async function test() {
  console.log('--- Testing System Information ---');
  try {
    const cpu = await si.cpu();
    console.log('CPU:', cpu.manufacturer, cpu.brand, cpu.speed, 'GHz', cpu.cores, 'cores');
    
    const load = await si.currentLoad();
    console.log('Current Load:', load.currentLoad.toFixed(2), '%');
    console.log('Cores:', load.cpus.length);

    const mem = await si.mem();
    console.log('Memory Total:', (mem.total / 1024 / 1024 / 1024).toFixed(2), 'GB');
    console.log('Memory Active:', (mem.active / 1024 / 1024 / 1024).toFixed(2), 'GB');

    const temp = await si.cpuTemperature();
    console.log('CPU Temp:', temp.main, 'C');

    const net = await si.networkInterfaceDefault().then(iface => si.networkStats(iface));
    console.log('Network:', net[0]?.iface, 'RX:', net[0]?.rx_sec, 'TX:', net[0]?.tx_sec);

  } catch (err) {
    console.error('Error:', err);
  }
}

test();
