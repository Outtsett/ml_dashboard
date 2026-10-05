const run = async () => {
  const res = await fetch("http://127.0.0.1:5000/api/charts/ohlcv?symbol=MNQ&timeframe=1m&count=50000");
  const text = await res.text();
  console.log("Response:", text.substring(0, 500));
};
run();
