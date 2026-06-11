declare module '*.css';

declare namespace JSX {
  interface IntrinsicElements {
    'model-viewer': import('react').DetailedHTMLProps<import('react').HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string;
      'camera-controls'?: string;
      'auto-rotate'?: string;
      'interaction-prompt'?: string;
    };
  }
}
