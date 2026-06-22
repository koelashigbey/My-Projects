import java.awt.*;
import javax.swing.*;

public class Bin2DecGUI extends JFrame {

    public static boolean isValidBinary(String input) {
        if (input == null || input.isEmpty()) return false;
        for (int i = 0; i < input.length(); i++) {
            char c = input.charAt(i);
            if (c != '0' && c != '1') return false;
        }
        return true;
    }

    public static int binaryToDecimal(String binary) {
        int decimal = 0;
        int length = binary.length();
        for (int i = 0; i < length; i++) {
            int digit = binary.charAt(i) - '0';
            decimal += digit * (int) Math.pow(2, length - 1 - i);
        }
        return decimal;
    }

    public Bin2DecGUI() {
        // Window setup
        setTitle("Bin2Dec Converter");
        setSize(400, 200);
        setDefaultCloseOperation(EXIT_ON_CLOSE);
        setLocationRelativeTo(null);  // centers the window
        setLayout(new GridLayout(4, 1, 10, 10));

        // Components
        JLabel inputLabel  = new JLabel("Enter Binary Number:");
        JTextField inputField  = new JTextField();
        JLabel errorLabel  = new JLabel(" ");
        JLabel outputLabel = new JLabel("Decimal: —");

        // Style
        errorLabel.setForeground(Color.RED);
        outputLabel.setFont(new Font("Monospaced", Font.BOLD, 16));
        inputLabel.setHorizontalAlignment(SwingConstants.CENTER);
        outputLabel.setHorizontalAlignment(SwingConstants.CENTER);
        errorLabel.setHorizontalAlignment(SwingConstants.CENTER);

        // Logic — triggers when user presses Enter
        inputField.addActionListener(e -> {
            String input = inputField.getText().trim();

            if (!isValidBinary(input)) {
                errorLabel.setText("ERROR: Only 0s and 1s are allowed!");
                outputLabel.setText("Decimal: —");
            } else {
                errorLabel.setText(" ");
                outputLabel.setText("Decimal: " + binaryToDecimal(input));
            }
        });

        // Add to window
        add(inputLabel);
        add(inputField);
        add(errorLabel);
        add(outputLabel);

        setVisible(true);
    }

    public static void main(String[] args) {
        new Bin2DecGUI();
    }
}