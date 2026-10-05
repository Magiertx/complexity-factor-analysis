import pandas # for collecting data
from factor_analyzer.factor_analyzer import calculate_bartlett_sphericity, calculate_kmo, FactorAnalyzer
from sklearn.decomposition import FactorAnalysis, PCA
from sklearn.preprocessing import StandardScaler
import matplotlib.pyplot as plt
import math
import numpy as np
from . import Constants

class ComplexityFactorAnalysis:
    def __init__(self, complexity_data):
        self.full_complexity_data = complexity_data
        self.complexity_data = complexity_data
        self.constant_variables = []
        self.bartlett_chi_squared = None
        self.bartlett_p_value = None
        self.msa_per_variable = []
        self.msa_insufficient_variables = {}
        self.overall_msa = None
        self.factor_analyzer = None
        self.factor_loadings = None
        self.communalities = None
        self.pca_explained_variance_ratio = []
        self.number_of_factors = None
        self.descriptive_statistics = None

    def clean_data_from_constant_variables(self):
        print("\nI will now check if the data contains variables whose values are constant.")
        print("Variables like this would make the data matrix linear dependent and hinder the calculation of determinants.")
        # create a list for variables with constant values.
        constant_variables = []
        # go through all complexity measures in the data.
        for column in self.complexity_data:
            # value stores the value of the first entry.
            # we initialize this variable with 0 and collect the correct entry later.
            value = 0
            # we store which iteration we are performing, so we know when to compare values.
            iteration = 0
            # initialize a boolean that represents whether all values are constant.
            constant = True
            # go through all values in the column respective to the current complexity measure.
            for other_value in self.complexity_data[column]:
                # if this is the first iteration, we have nothing to compare.
                if iteration == 0:
                    # instead, we set value to the first complexity score we encounter.
                    value = other_value
                # otherwise, we check if the first value differs from the current one.
                elif value != other_value:
                    # if so, we found a counter example showing that not all values are constant.
                    constant = False
                    # we can then break out of the loop, as all other values do not matter anymore.
                    break
                # increase the number for the current iteration.
                iteration += 1
            # check whether values of the current complexity measure were constant.
            if constant:
                # if so, inform the user via command line.
                print(column, "has only constant values.")
                # then add the name of the complexity measure to the set of constant variables.
                self.constant_variables += [column]
        # check if there was at least one variable with only constant values.
        if len(self.constant_variables) > 0:
            # if so, inform the user that we remove these variables from the analysis.
            print("I will thus remove the aforementioned variables from the statistical analysis.")
            # do so by removing the columns from the complexity data.
            self.complexity_data = self.complexity_data.drop(columns=self.constant_variables)
        else:
            # otherwise inform the user that no constant variables were found.
            print("No constant variables found!")

    def execute_Bartletts_test_of_sphericity(self):
        print("\nNext, I will perform Bartlett's test of sphericity to check whether there are interdependencies between the variables.")
        # initialize a variable to store whether Bartlett's test of spericity succeeded.
        bartlett_ok = True
        # execute the test with the python library factor_analyzer.
        self.bartlett_chi_squared, self.bartlett_p_value = calculate_bartlett_sphericity(self.complexity_data)
        # inform the user about the resulting values.
        print("chi squared value:", self.bartlett_chi_squared)
        print("p-value:", self.bartlett_p_value)
        # inform the user whether Bartlett's test of spericity succeeded or not.
        if self.bartlett_p_value < Constants.bartlett_p_value_threshold:
            print(Constants.SUCCESS_COLOR, end="")
            print("Bartlett's test of sphericity succeeded!")
            print("Since the p-value " + str(self.bartlett_p_value) + " is lower than " + str(Constants.bartlett_p_value_threshold) + ", we can be fairly certain that the variables are correlated.")
            print(Constants.RESET_COLOR, end="")
        else:
            print(Constants.FAILURE_COLOR, end="")
            print("Bartlett's test of sphericity failed!")
            print("Since the p-value " + str(self.bartlett_p_value) + " is higher than " + str(Constants.bartlett_p_value_threshold) + ", we cannot be sure that the variables are correlated.")
            print("Performing a factor analysis on these data is not recommended.")
            # store that Bartlett's test of sphericity did not succeed
            bartlett_ok = False
            print(Constants.RESET_COLOR, end="")
        # return whether the test was successful or not.
        return bartlett_ok

    def calculate_measure_of_sampling_adequacy(self):
        # check if the data set does not contain any entries.
        if len(self.complexity_data) == 0:
            # if so, return a boolean indicating that the MSA is insufficient.
            return False
        # create a list for the variables with insufficient MSA.
        insufficient_msa = []
        # create a boolean indicating whether the overall MSA is sufficient.
        overall_msa_sufficient = True
        # calculate the measure of sampling adequacy using the python library factor_analyzer.
        self.msa_per_variable, self.overall_msa = calculate_kmo(self.complexity_data)
        # inform the user about the results.
        print("variable-specific MSA:")
        index = 0
        # go through all complexity measures.
        for column in self.complexity_data:
            # collect the msa value of the current complexity measure.
            msa_value = self.msa_per_variable[index]
            # print the name of the complexity measure.
            print("- " + str(column) + ": ", end="")
            # print the value in red if it is below a given threshold
            if msa_value < Constants.msa_threshold:
                print(Constants.FAILURE_COLOR, end="")
                # add the current measure and its msa value to the list of variables with insufficient msa.
                self.msa_insufficient_variables[column] = msa_value
                insufficient_msa += [column]
            # print the value in green if it is above or equal to the given threshold.
            else:
                print(Constants.SUCCESS_COLOR, end="")
            print(self.msa_per_variable[index])
            # increment the index for the next complexity measure.
            index += 1
            print(Constants.RESET_COLOR, end="")
        # inform the user about the overall msa value.
        print("overall MSA: ", end="")
        # print the value in red if it is below the given threshold.
        if self.overall_msa < Constants.msa_threshold:
            print(Constants.FAILURE_COLOR, end="")
            # store that the overall msa was not sufficient.
            overall_msa_sufficient = False
        # print the value in green if it is above or equal to the given threshold.
        else:
            print(Constants.SUCCESS_COLOR, end="")
        print(self.overall_msa)
        print(Constants.RESET_COLOR, end="")
        # check if the msa returned only positive values.
        if len(insufficient_msa) == 0 and self.overall_msa >= Constants.msa_threshold:
            # if so, inform the user that performing a factor analysis will be valid.
            print(Constants.SUCCESS_COLOR, end="")
            print("Since all MSA values are greater than or equal to " + str(Constants.msa_threshold) + ", we can be fairly certain that the variables are correlated.")
            print(Constants.RESET_COLOR, end="")
        return overall_msa_sufficient, insufficient_msa

    def repeat_calculate_measure_of_sampling_adequacy(self):
        print("\nNext, I will calculate the measure of sampling adequacy...")
        # calculate the measure of sampling adequacy for the given dataset.
        msa_ok, insufficient_msa = self.calculate_measure_of_sampling_adequacy()
        # repeat the calculation until no new variables with insufficient msa emerged.
        while len(insufficient_msa) != 0:
            print("It seems there is a variable whose MSA value is too low.")
            print("I will now remove this variable from the analysis.")
            # remove the variables with insufficient msa values from the analysis.
            self.complexity_data = self.complexity_data.drop(columns=insufficient_msa)
            print("Now, I will recalculate the measure of sampling adequacy...")
            # calculate the new msa values.
            msa_ok, insufficient_msa = self.calculate_measure_of_sampling_adequacy()
            # abort if the overall msa value is below the threshold at any time.
            if not msa_ok:
                print(Constants.FAILURE_COLOR, end="")
                print("Sorry, the overall measure of sampling adequacy is too low.")
                print("Since the overall msa value " + str(self.overall_msa) + " is lower than " + str(Constants.msa_threshold) + ", we cannot be sure that the variables are correlated.")
                print("Performing a factor analysis on these data is not recommended.")
                print(Constants.RESET_COLOR, end="")
        return msa_ok

    def calculate_scree_plot(self, show_plot=False):
        # fit the standard scaler to the data.
        scaler = StandardScaler()
        scaler.fit(self.complexity_data)
        # transform the data with the scaler.
        # this means: for each column, calculate the mean m and the standard deviation d.
        # then, the new entry of a cell is x_new = (x_old - m) / d.
        transformed_data = scaler.transform(self.complexity_data)
        # initialize a principal component analyzer with components equal to the number of complexity measures.
        principal_component_analyzer = PCA(n_components=len(list(self.complexity_data)))
        # fit the principal component analyzer to the data.
        pca_fit = principal_component_analyzer.fit(transformed_data)
        # store the explained variance ratio returned by the pricipal component analysis.
        self.pca_explained_variance_ratio = principal_component_analyzer.explained_variance_ratio_
        # if the user chose to display the results, create a plot and show it.
        if show_plot:
            PC_values = np.arange(principal_component_analyzer.n_components_) + 1
            plt.plot(PC_values, self.pca_explained_variance_ratio, 'o-', linewidth=2, color='blue')
            plt.title('Scree Plot')
            plt.xlabel('Factor Number')
            plt.ylabel('Variance Explained')
            plt.show()

    def perform_factor_analysis(self, expected_number_of_factors, rotation='varimax', show_plot=False):
        self.number_of_factors = expected_number_of_factors
        # collect descriptive statistics of the complexity values.
        self.descriptive_statistics = pandas.DataFrame({"Mean": self.full_complexity_data.mean(), "Median": self.full_complexity_data.median(), "Std": self.full_complexity_data.std(), "Min": self.full_complexity_data.min(), "Max": self.full_complexity_data.max()})
        # initialize a factor analyzer with the specified number of factors and the specified rotation.
        self.factor_analyzer = FactorAnalyzer(n_factors=expected_number_of_factors, rotation=rotation)
        # perform the factor analysis on the complexity data.
        self.factor_analyzer.fit(self.complexity_data)
        # store the resulting factor loadings into a matrix.
        self.factor_loadings = self.factor_analyzer.loadings_
        # store the communalities for each variable in a list.
        self.communalities = self.factor_analyzer.get_communalities()
        if show_plot:
            # print the descriptive stats on the command line.
            print(self.descriptive_statistics)
            # plot the data as a heat map.
            fig, axis = plt.subplots(figsize=(7,10))
            im = axis.imshow(self.factor_loadings, cmap="RdBu_r", vmax=1, vmin=-1)
            # and add the corresponding value to the center of each cell.
            for (i,j), z in np.ndenumerate(self.factor_loadings):
                axis.text(j, i, str(z.round(2)), ha="center", va="center")
            # tell matplotlib about the metadata of the plot.
            axis.set_yticks(np.arange(len(list(self.complexity_data))))
            if axis.get_subplotspec().is_first_col():
                axis.set_yticklabels(list(self.complexity_data))
            else:
                axis.set_yticklabels([])
            axis.set_title("Varimax Factor Analysis")
            axis.set_xticks(range(expected_number_of_factors))
            factor_names = []
            for i in range(1, expected_number_of_factors + 1):
                factor_names += ["F" + str(i)]
            axis.set_xticklabels(factor_names)
            # and squeeze the axes tight, to save space.
            plt.tight_layout()
            # add a colorbar.
            cb = fig.colorbar(im, ax=axis, location='right', label="loadings")
            # show the plot.
            plt.show()
            # calculate the communalities as the sum of squared values in the loading matrix
            # for each complexity measure. The communalities then show how much of the data
            # for a complexity measure can be explained by the factors.
            communalities = pandas.Series(self.communalities, index=list(self.complexity_data))
            # plot the communalities as a bar diagram.
            communalities.plot(kind="bar", ylabel="Communalities")
            # show the plot.
            plt.show()
