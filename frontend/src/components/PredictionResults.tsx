import type { Prediction } from '../types';

interface PredictionResultsProps {
  predictions: Prediction[];
}

const PredictionResults = ({ predictions }: PredictionResultsProps) => {
  return (
    <div className="results-container">
      <h2>Classification Results</h2>
      <p className="model-label">Model: ResNet50 (ImageNet)</p>

      <div className="predictions-list">
        {predictions.map((prediction, index) => (
          <div key={index} className="prediction-item">

            {/* Label and confidence percentage */}
            <div className="prediction-header">
              <span className="prediction-label">
                {prediction.label}
              </span>
              <span className="prediction-confidence">
                {(prediction.confidence * 100).toFixed(1)}%
              </span>
            </div>

            {/* Confidence bar */}
            <div className="confidence-bar-background">
              <div
                className="confidence-bar-fill"
                style={{ width: `${prediction.confidence * 100}%` }}
              />
            </div>

          </div>
        ))}
      </div>
    </div>
  );
};

export default PredictionResults;