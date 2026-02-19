import * as tf from '@tensorflow/tfjs-node';

export interface CNNConfig {
  sequenceLength: number;
  numFeatures: number;
  filters: number[];
  kernelSizes: number[];
  dropoutRate: number;
  learningRate: number;
  outputSize: number;
}

export const defaultConfig: CNNConfig = {
  sequenceLength: 60,
  numFeatures: 5,
  filters: [32, 64, 128],
  kernelSizes: [3, 3, 3],
  dropoutRate: 0.2,
  learningRate: 0.001,
  outputSize: 3,
};

export function createCNNModel(config: CNNConfig = defaultConfig): tf.Sequential {
  const model = tf.sequential();

  model.add(tf.layers.conv1d({
    inputShape: [config.sequenceLength, config.numFeatures],
    filters: config.filters[0],
    kernelSize: config.kernelSizes[0],
    activation: 'relu',
    padding: 'same',
  }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.maxPooling1d({ poolSize: 2 }));
  model.add(tf.layers.dropout({ rate: config.dropoutRate }));

  for (let i = 1; i < config.filters.length; i++) {
    model.add(tf.layers.conv1d({
      filters: config.filters[i],
      kernelSize: config.kernelSizes[i],
      activation: 'relu',
      padding: 'same',
    }));
    model.add(tf.layers.batchNormalization());
    model.add(tf.layers.maxPooling1d({ poolSize: 2 }));
    model.add(tf.layers.dropout({ rate: config.dropoutRate }));
  }

  model.add(tf.layers.globalAveragePooling1d());

  model.add(tf.layers.dense({
    units: 64,
    activation: 'relu',
  }));
  model.add(tf.layers.dropout({ rate: config.dropoutRate }));

  model.add(tf.layers.dense({
    units: config.outputSize,
    activation: 'softmax',
  }));

  model.compile({
    optimizer: tf.train.adam(config.learningRate),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });

  return model;
}

export function getModelSummary(model: tf.Sequential): string {
  const layers: string[] = [];
  model.layers.forEach((layer, i) => {
    const config = layer.getConfig();
    layers.push(`Layer ${i}: ${layer.name} - ${JSON.stringify(config)}`);
  });
  return layers.join('\n');
}
